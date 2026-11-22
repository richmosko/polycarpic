#!/usr/bin/env bash
# POLY-97 R4, R6: read-only checks of a provisioned box. Run as root on the box:
#   sudo bash provision-check.sh --b2-capabilities <file> --b2-bucket <name> [--prod]
# One line per check: PASS | FAIL (with a fix) | WAIT | WARN | INFO. The last line is the summary; the exit code is
# 0 (all passed, possibly with warnings), 1 (any FAIL) or 3 (host checks passed, the rest waits for the first deploy).
# Nothing here writes a file under /etc or /srv (D3 appends one line to /var/lib/polycarpic/state/jobs.log), and no secret is printed or put in argv.
# shellcheck disable=SC2317  # d1..d6 are called through per_project
set -uo pipefail

ETC=/etc/polycarpic
DATA=/srv/polycarpic
STATE=/var/lib/polycarpic/state
b2_caps_file='' b2_bucket='' prod=0
while [ $# -gt 0 ]; do
  case "$1" in
    --b2-capabilities) b2_caps_file=${2:-}; shift 2 ;;
    --b2-bucket) b2_bucket=${2:-}; shift 2 ;;
    --prod) prod=1; shift ;;
    *) echo "usage: provision-check.sh --b2-capabilities <file> --b2-bucket <name> [--prod]" >&2; exit 2 ;;
  esac
done
# A cluster in pg-prod means real data may exist: warnings become failures.
[ -f "$DATA/pg-prod/PG_VERSION" ] && prod=1

n_fail=0 n_wait=0 n_warn=0 warn_ids=()
pass() { echo "PASS $1 $2"; }
fail() { echo "FAIL $1 $2: $3 — fix: $4"; n_fail=$((n_fail + 1)); }
wait_() { echo "WAIT $1 $2: $3"; n_wait=$((n_wait + 1)); }
info() { echo "INFO $1 $2: checked off-box by $3"; }
warn() { # id what consequence fix
  if [ "$prod" = 1 ]; then
    fail "$1" "$2 not configured" "$3" "$4"
  else
    echo "WARN $1 $2 not configured: $3"; n_warn=$((n_warn + 1)); warn_ids+=("$1")
  fi
}
# report <id> <what> <problems> <fix>: PASS when there is no problem text.
report() { if [ -z "$3" ]; then pass "$1" "$2"; else fail "$1" "$2" "${3# }" "$4"; fi; }
join() { local IFS="$1"; shift; echo "$*"; }

PROD_SERVICES="postgres web worker migrate backup uploader operator auth caddy"
STAGING_SERVICES="postgres web worker migrate operator auth"
gid_of() {
  case "$1" in
    postgres) echo 999 ;; web) echo 10001 ;; worker) echo 10002 ;; migrate) echo 10003 ;; backup) echo 10004 ;;
    uploader) echo 10005 ;; operator) echo 10006 ;; auth) echo 10007 ;; caddy) echo 10010 ;;
  esac
}
# The files compose mounts from each service directory (infra/compose/*.yml, single source in provision.sh's table).
files_for() {
  case "$1" in
    postgres) echo db_superuser_password ;; web) echo "db_password_app plaid_secret" ;;
    auth) echo "db_password_auth auth_secret resend_api_key" ;; worker) echo "db_password_worker credential_keyring resend_api_key" ;;
    migrate) echo db_password_migrator ;; operator) echo db_password_operator ;; backup) echo db_password_backup ;;
    uploader) echo "backup_store_credential heartbeat_url" ;; caddy) echo staging_basic_auth ;;
  esac
}
in_list() { local x=$1; shift; local i; for i in "$@"; do [ "$i" = "$x" ] && return 0; done; return 1; }

# ------------------------------------------------------------------ H1 sshd
sshd_t=$(sshd -T 2> /dev/null || true)
sshd_val() { awk -v k="$1" '$1 == k { print $2; exit }' <<< "$sshd_t" | sed -e 's/^false$/no/' -e 's/^true$/yes/'; }
h1=''
if [ -z "$sshd_t" ]; then
  h1=' sshd -T printed nothing'
else
  for kv in passwordauthentication=no kbdinteractiveauthentication=no permitrootlogin=no pubkeyauthentication=yes \
    allowtcpforwarding=no allowagentforwarding=no allowstreamlocalforwarding=no x11forwarding=no permittunnel=no; do
    got=$(sshd_val "${kv%%=*}")
    [ "$got" = "${kv##*=}" ] || h1="$h1 ${kv%%=*} is ${got:-unset} (want ${kv##*=});"
  done
fi
report H1 "sshd running config" "$h1" "fix the drop-in /etc/ssh/sshd_config.d/10-polycarpic.conf and remove any earlier-sorted file that overrides it, then: sudo systemctl reload ssh"

# ------------------------------------------------------------------ H2 unattended upgrades
apt_dump=$(apt-config dump 2> /dev/null || true)
h2=''
grep -q 'APT::Periodic::Unattended-Upgrade "1"' <<< "$apt_dump" || h2=' APT::Periodic::Unattended-Upgrade is not "1";'
grep -q 'APT::Periodic::Update-Package-Lists "1"' <<< "$apt_dump" || h2="$h2 APT::Periodic::Update-Package-Lists is not \"1\";"
report H2 "unattended upgrades" "$h2" "sudo bash provision.sh --stage host --target hetzner --domain <domain> (rewrites /etc/apt/apt.conf.d/20auto-upgrades)"

# ------------------------------------------------------------------ H3 docker daemon
h3=''
info_json=$(docker info --format '{{json .}}' 2> /dev/null || true)
if [ -z "$info_json" ]; then
  h3=' docker info printed nothing'
else
  [ "$(jq -r '.LiveRestoreEnabled' <<< "$info_json")" = true ] || h3="$h3 live-restore is off;"
  [ "$(jq -r '.LoggingDriver' <<< "$info_json")" = json-file ] || h3="$h3 log driver is $(jq -r '.LoggingDriver' <<< "$info_json");"
  pools=$(jq -c '[.DefaultAddressPools[]? | {b: .Base, s: .Size}]' <<< "$info_json")
  [ "$pools" = '[{"b":"10.200.0.0/16","s":24}]' ] || h3="$h3 default address pools $pools (want 10.200.0.0/16 size 24);"
  ov=$(jq -r '.DefaultAddressPools[]?.Base' <<< "$info_json" | python3 -c '
import ipaddress, sys
res = [ipaddress.ip_network("10.201.0.0/16"), ipaddress.ip_network("10.202.0.0/16")]
for line in sys.stdin:
    try:
        n = ipaddress.ip_network(line.strip(), strict=False)
    except ValueError:
        continue
    for r in res:
        if n.overlaps(r):
            print("pool %s overlaps the fixed range %s;" % (n, r))
')
  [ -z "$ov" ] || h3="$h3 $ov"
fi
if [ -f /etc/docker/daemon.json ]; then
  [ "$(jq -c '[.["log-opts"]["max-size"], .["log-opts"]["max-file"], .["userland-proxy"]]' /etc/docker/daemon.json 2> /dev/null)" = '["10m","5",false]' ] \
    || h3="$h3 /etc/docker/daemon.json does not hold log-opts 10m/5 and userland-proxy false;"
else
  h3="$h3 /etc/docker/daemon.json is missing;"
fi
report H3 "docker daemon" "$h3" "sudo bash provision.sh --stage host --target hetzner --domain <domain>, then sudo systemctl restart docker"

# ------------------------------------------------------------------ H4 data volume
h4=''
src=$(findmnt -n -o SOURCE "$DATA" 2> /dev/null || true)
[ "$src" = /dev/mapper/polycarpic-data ] || h4="$h4 $DATA is mounted from ${src:-nothing} (want /dev/mapper/polycarpic-data);"
dev=$(awk '$1 == "polycarpic-data" { print $2; exit }' /etc/crypttab 2> /dev/null)
if [ -z "$dev" ]; then
  h4="$h4 no polycarpic-data line in /etc/crypttab;"
else
  if cryptsetup isLuks "$dev" 2> /dev/null; then
    ver=$(cryptsetup luksDump "$dev" 2> /dev/null | awk '/^Version:/ { print $2; exit }')
    [ "$ver" = 2 ] || h4="$h4 the volume header is LUKS${ver:-?} (want LUKS2);"
  else
    h4="$h4 $dev is not a LUKS device;"
  fi
fi
if [ -f "$ETC/luks.key" ]; then
  km=$(stat -c '%a %U' "$ETC/luks.key")
  [ "$km" = "400 root" ] || h4="$h4 the key file luks.key is mode/owner $km (want 400 root);"
else
  h4="$h4 the key file $ETC/luks.key is missing;"
fi
report H4 "encrypted data volume" "$h4" "do not edit by hand: rerun provision.sh on a fresh volume, or restore the volume per INFRA §8"

# ------------------------------------------------------------------ H5 swap
h5=''
[ -z "$(swapon --show 2> /dev/null | grep -v '^NAME' || true)" ] || h5="$h5 swap is active;"
grep -qE '^[^#]*[[:space:]]swap[[:space:]]' /etc/fstab 2> /dev/null && h5="$h5 a swap line is in fstab;"
report H5 "swap" "$h5" "sudo swapoff -a and delete the swap line from /etc/fstab"

# ------------------------------------------------------------------ H6 secrets
h6=''
tmp_h=$(mktemp -d /dev/shm/pcheck.XXXXXX)
trap 'rm -rf "$tmp_h"' EXIT
secret_root() { # root services
  local root=$1 services=$2 svc d f gid mode
  [ -d "$root" ] || { h6="$h6 $root is missing;"; return; }
  mode=$(stat -c '%a %U:%G' "$root")
  [ "$mode" = "700 root:root" ] || h6="$h6 $root is $mode (want 700 root:root);"
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    svc=$(basename "$d")
    # shellcheck disable=SC2086
    if ! in_list "$svc" $services; then h6="$h6 $d must not exist here;"; continue; fi
    gid=$(gid_of "$svc")
    [ "$(stat -c '%a %u:%g' "$d")" = "750 0:$gid" ] || h6="$h6 $d is $(stat -c '%a %u:%g' "$d") (want 750 0:$gid);"
    for f in "$d"*; do
      [ -e "$f" ] || continue
      # shellcheck disable=SC2046
      if ! in_list "$(basename "$f")" $(files_for "$svc"); then h6="$h6 $f is not a file compose mounts from $svc;"; continue; fi
      [ "$(stat -c '%a %u:%g' "$f")" = "440 0:$gid" ] || h6="$h6 $f is $(stat -c '%a %u:%g' "$f") (want 440 0:$gid);"
    done
  done
}
secret_root "$ETC/secrets" "$PROD_SERVICES"
secret_root "$ETC/staging-secrets" "$STAGING_SERVICES"
while IFS= read -r f; do
  case "$f" in
    "$ETC/host.env" | "$ETC/staging-host.env" | "$ETC/age-recipients.txt") ;;
    "$ETC/ops.conf") # POLY-98 R3: world-readable by design, so it may hold only bucket-name lines
      if [ ! -s "$f" ] || grep -qvE '^B2_BUCKET=[a-z0-9-]{6,50}$' "$f" 2> /dev/null; then h6="$h6 $f holds a line other than B2_BUCKET=<name>;"; fi ;;
    *) h6="$h6 $f is world-readable;" ;;
  esac
done < <(find "$ETC" -type f -perm -o=r 2> /dev/null)
# no two secrets alike: compare hashes, print only paths
find "$ETC/secrets" "$ETC/staging-secrets" -type f -exec sha256sum {} + 2> /dev/null | sort > "$tmp_h/sums"
dups=$(awk '{ c[$1]++; p[$1] = p[$1] " " $2 } END { for (h in c) if (c[h] > 1) print p[h] }' "$tmp_h/sums")
# POLY-98 R4, K6: copies of one value pass only when every copy has the same basename, sits in the same tree (secrets/ or
# staging-secrets/), is a file compose mounts from its own service, and is not a name a tool generates or owns.
dup_ok() { # paths...
  local f name='' tree='' svc b t
  for f in "$@"; do
    b=$(basename "$f"); svc=$(basename "$(dirname "$f")"); t=$(dirname "$(dirname "$f")")
    case "$b" in db_superuser_password | db_password_* | auth_secret | credential_keyring | staging_basic_auth) return 1 ;; esac
    # shellcheck disable=SC2046
    in_list "$b" $(files_for "$svc") || return 1
    if [ -z "$name" ]; then name=$b; tree=$t; fi
    { [ "$b" = "$name" ] && [ "$t" = "$tree" ]; } || return 1
  done
}
dup_bad=''
while IFS= read -r grp; do
  [ -n "$grp" ] || continue
  # shellcheck disable=SC2086
  dup_ok $grp || dup_bad="$dup_bad$grp
"
done <<< "$dups"
[ -z "$dup_bad" ] || h6="$h6 files with the same content:$(tr '\n' ';' <<< "$dup_bad")"
report H6 "secrets layout and modes" "$h6" "inspect the paths named; restore the mode, or delete a copied file (never print a secret); see INFRA §6.4"

# ------------------------------------------------------------------ H7 data dirs, spool, ACLs
h7=''
expect_acl=$(printf '%s\n' 'default:group::---' 'default:mask::rwx' 'default:other::---' 'default:user::rwx' 'default:user:10005:rwx' \
  'group::---' 'mask::rwx' 'other::---' 'user::rwx' 'user:10005:rwx' | LC_ALL=C sort)
for d in pg-prod pg-staging; do
  got=$(stat -c '%a %u:%g' "$DATA/$d" 2> /dev/null || echo missing)
  [ "$got" = "700 999:999" ] || h7="$h7 $d is $got (want 700 999:999);"
done
for pair in spool/wal:999:999 spool/dump:10004:10004 spool/premigration:10004:10004; do
  d=${pair%%:*}; own=${pair#*:}
  if [ ! -d "$DATA/$d" ]; then h7="$h7 $d is missing;"; continue; fi
  got=$(stat -c '%u:%g' "$DATA/$d")
  [ "$got" = "$own" ] || h7="$h7 $d is owned by $got (want $own);"
  acl=$(getfacl -cp "$DATA/$d" 2> /dev/null | grep -v '^$' | sed 's/[[:space:]]*#effective.*//' | LC_ALL=C sort)
  if [ "$acl" != "$expect_acl" ]; then
    missing=$(LC_ALL=C comm -13 <(echo "$acl") <(echo "$expect_acl") | tr '\n' ' ')
    extra=$(LC_ALL=C comm -23 <(echo "$acl") <(echo "$expect_acl") | tr '\n' ' ')
    h7="$h7 $d ACL differs (missing: ${missing:-none}; unexpected: ${extra:-none});"
  fi
done
while IFS= read -r f; do
  line=$(getfacl -cp "$f" 2> /dev/null | grep '^user:10005:' || true)
  if [ -z "$line" ]; then
    h7="$h7 $f has no ACL entry for uid 10005;"
  else
    eff=${line#user:10005:}; eff=${eff%% *}
    [[ $line =~ \#effective:([rwx-]+) ]] && eff=${BASH_REMATCH[1]}
    case "$eff" in r*) ;; *) h7="$h7 $f gives uid 10005 effective $eff (a chmod after creation removed the read);" ;; esac
  fi
done < <(find "$DATA/spool" -type f -name '*.age' ! -path '*/.inflight/*' 2> /dev/null)
report H7 "data dirs, spool and ACLs" "$h7" "never chmod a spool file; to repair: sudo bash provision.sh --stage host ... (sets the ACLs), then re-create the file through its writer"

# ------------------------------------------------------------------ H8 spool contents
h8=''
while IFS= read -r f; do h8="$h8 stray file $f;"; done < <(find "$DATA/spool" -type f ! -name '*.age' ! -name '*.sha256' ! -path '*/.inflight/*' 2> /dev/null)
while IFS= read -r f; do h8="$h8 inflight file older than 10 minutes: $f;"; done < <(find "$DATA/spool/wal/.inflight" -type f -mmin +10 2> /dev/null)
report H8 "spool contents" "$h8" "a stale or stray spool file means an interrupted writer: inspect it, move it out, and run the backup again (INFRA §6.1)"

# ------------------------------------------------------------------ H9 service gids
h9=''
while IFS=: read -r user _ _ gid _; do
  [ "$user" = root ] && continue
  if [ "$gid" = 999 ] || { [ "$gid" -ge 10001 ] && [ "$gid" -le 10010 ]; }; then h9="$h9 $user has primary gid $gid;"; fi
done < <(getent passwd)
while IFS= read -r line; do
  name=${line%%:*}; rest=${line#*:*:}; g=${rest%%:*}; members=${rest#*:}
  if [ "$g" = 999 ] || { [ "$g" -ge 10001 ] && [ "$g" -le 10010 ]; } || [ "$name" = docker ]; then
    for u in ${members//,/ }; do [ "$u" = root ] || h9="$h9 $u is in group $name (gid $g);"; done
  fi
done < <(getent group)
report H9 "service gids" "$h9" "remove the account from the group (sudo gpasswd -d <user> <group>); only root may hold a service gid or docker"

# ------------------------------------------------------------------ H10 env files
h10=''
for f in host.env staging-host.env; do
  p=$ETC/$f
  if [ ! -f "$p" ]; then h10="$h10 $p is missing;"; continue; fi
  origin=$(sed -n 's/^PUBLIC_ORIGIN=//p' "$p" | head -1)
  dom=${origin#https://*.}
  mf=$(sed -n 's/^MAIL_FROM=//p' "$p" | head -1 | sed -e 's/^"//' -e 's/"$//')
  addr=${mf##*<}; addr=${addr%%>*}
  [ -n "$dom" ] && [ "${addr##*@}" = "mail.$dom" ] || h10="$h10 $f MAIL_FROM is '${mf}' (want an address under mail.${dom:-<domain>});"
  while IFS= read -r k; do
    h10="$h10 $f holds the secret-named key $k;"
  done < <(sed -n 's/^\([A-Za-z0-9_]*\)=.*/\1/p' "$p" | grep -iE '(PASSWORD|SECRET|TOKEN|_KEY|CREDENTIAL)' || true)
done
report H10 "host.env files" "$h10" "edit the file: keep only TLS_MODE, PUBLIC_ORIGIN, MAIL_FROM, POLY_INSTANCE (secrets live under $ETC/secrets), or rerun provision.sh --stage host"

# ------------------------------------------------------------------ H11 age recipients
h11=''
if [ ! -f "$ETC/age-recipients.txt" ]; then
  h11=" $ETC/age-recipients.txt is missing;"
else
  count=$(grep -c . "$ETC/age-recipients.txt" || true)
  good=$(grep -cE '^age1[a-z0-9]+$' "$ETC/age-recipients.txt" || true)
  { [ "$count" = 1 ] && [ "$good" = 1 ]; } || h11=" age-recipients.txt holds $count non-empty lines, $good of them age1 keys (want exactly 1 and 1);"
fi
report H11 "age recipient" "$h11" "echo 'age1...yourpublickey' | sudo tee $ETC/age-recipients.txt (INFRA §7.1 step 6)"

# ------------------------------------------------------------------ H12 box B2 key
cred=$ETC/secrets/uploader/backup_store_credential
fixh12="delete key polycarpic-put-only; recreate it with infra/operator/b2-setup.py"
if [ -z "$b2_caps_file" ] || [ -z "$b2_bucket" ] || [ ! -r "$b2_caps_file" ] || ! jq -e '.capabilities | type == "array"' "$b2_caps_file" > /dev/null 2>&1; then
  fail H12 "box B2 key" "the capability file or the bucket name is missing or unreadable" "pass --b2-capabilities <file> --b2-bucket <name>"
elif [ ! -f "$cred" ]; then
  wait_ H12 "box B2 key" "waits for $cred (set at the first deploy)"
else
  id=$(sed -n 1p "$cred"); key=$(sed -n 2p "$cred")
  resp=$(printf 'user = "%s:%s"\n' "$id" "$key" | curl -sS -f --max-time 20 --config - https://api.backblazeb2.com/b2api/v2/b2_authorize_account 2> /dev/null)
  rc=$?
  unset id key
  if [ "$rc" != 0 ] || ! jq -e '.allowed' > /dev/null 2>&1 <<< "$resp"; then
    fail H12 "box B2 key" "Backblaze did not authorize the key (401 unauthorized or no answer)" "$fixh12"
  else
    want=$(jq -r '.capabilities | sort | .[]' "$b2_caps_file")
    got=$(jq -r '.allowed.capabilities // [] | sort | .[]' <<< "$resp")
    h12=''
    for c in $(comm -13 <(echo "$want") <(echo "$got")); do h12="$h12 holds the extra capability $c;"; done
    for c in $(comm -23 <(echo "$want") <(echo "$got")); do h12="$h12 is missing the capability $c;"; done
    bid=$(jq -r '.allowed.bucketId // empty' <<< "$resp")
    bname=$(jq -r '.allowed.bucketName // empty' <<< "$resp")
    pfx=$(jq -r '.allowed.namePrefix // empty' <<< "$resp")
    if [ -z "$bid" ] || [ -z "$bname" ]; then
      h12="$h12 is not restricted to a bucket (bucketName unset);"
    elif [ "$bname" != "$b2_bucket" ]; then
      h12="$h12 is restricted to bucket $bname, not $b2_bucket;"
    fi
    [ -z "$pfx" ] || h12="$h12 has a namePrefix restriction ($pfx);"
    unset resp
    report H12 "box B2 key" "$h12" "$fixh12"
  fi
fi
info H12b "bucket lock" "b2-setup.py"

# ------------------------------------------------------------------ H13 heartbeat
if [ -s "$ETC/secrets/uploader/heartbeat_url" ]; then
  pass H13 "heartbeat"
else
  warn H13 heartbeat "alert path B does not exist; a box going quiet or a full bucket goes unnoticed" "put the ping URL in $ETC/secrets/uploader/heartbeat_url (root:10005, 0440) with polycarpic-ops set-secret (INFRA §6.5)"
fi

# ------------------------------------------------------------------ H14 clock
# A box that just booted needs a moment to synchronise: look until it does, for up to POLY_NTP_WAIT seconds.
ntp=''
waited=0
while :; do
  ntp=$(timedatectl show -p NTPSynchronized 2> /dev/null || true)
  [ "$ntp" = "NTPSynchronized=yes" ] && break
  [ "$waited" -ge "${POLY_NTP_WAIT:-60}" ] && break
  sleep 1
  waited=$((waited + 1))
done
if [ "$ntp" = "NTPSynchronized=yes" ]; then
  pass H14 "clock"
else
  fail H14 "clock" "NTP is not synchronised after ${waited}s (${ntp:-timedatectl printed nothing})" "sudo timedatectl set-ntp true and wait a minute; check systemd-timesyncd"
fi

# ------------------------------------------------------------------ H15 operator access
h15=''
au=$(awk '$1 == "allowusers" { for (i = 2; i <= NF; i++) print $i }' <<< "$sshd_t" | sort -u | tr '\n' ' ')
[ "$au" = "polyops " ] || h15="$h15 sshd allowusers is '${au% }' (want polyops only);"
sf=''
for f in /etc/sudoers.d/*; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in README | .*) continue ;; esac
  body=$(grep -vE '^[[:space:]]*(#|$)' "$f" || true)
  if [ "$body" = 'polyops ALL=(ALL) NOPASSWD:ALL' ]; then
    sf="$sf $f"
    [ "$(stat -c '%a %u' "$f")" = "440 0" ] || h15="$h15 sudoers drop-in $f is mode $(stat -c %a "$f") (want 0440 root);"
  elif [ -n "$body" ]; then
    h15="$h15 sudoers file $f grants more than the one polyops line;"
  fi
done
[ "$(wc -w <<< "$sf")" = 1 ] || h15="$h15 expected exactly one sudoers drop-in for polyops, found$([ -n "$sf" ] && echo "$sf" || echo ' none');"
extra=$(grep -vE '^[[:space:]]*(#|$)' /etc/sudoers 2> /dev/null | grep -vE '^(Defaults|root[[:space:]]+ALL=\(ALL(:ALL)?\)[[:space:]]+ALL$|%admin[[:space:]]+ALL=\(ALL\)[[:space:]]+ALL$|%sudo[[:space:]]+ALL=\(ALL(:ALL)?\)[[:space:]]+ALL$|[@#]includedir[[:space:]]+/etc/sudoers.d$)' || true)
[ -z "$extra" ] || h15="$h15 /etc/sudoers has a line beyond Ubuntu's defaults;"
while IFS=: read -r user _ _ _ _ home shell; do
  case "$user" in root | polyops) continue ;; esac
  case "$shell" in */nologin | */false | '') continue ;; esac
  grep -qxF "$shell" /etc/shells 2> /dev/null || continue
  if [ -e "$home/.ssh/authorized_keys" ] || [ -e "$home/.ssh/authorized_keys2" ]; then h15="$h15 account $user has a login shell and an authorized_keys file;"; fi
done < <(getent passwd)
report H15 "operator access" "$h15" "remove the extra account or its authorized_keys; the sudoers drop-in is written by cloud-init (infra/hetzner/cloud-init.yaml)"

# ------------------------------------------------------------------ database checks
dc() { local proj=$1; shift; docker compose -p "polycarpic-$proj" "$@"; }
running() { dc "$1" ps --status running --services < /dev/null 2> /dev/null | grep -qx postgres; }
q() { local proj=$1; shift; dc "$proj" exec -T postgres psql -X -tA -U postgres -d polycarpic -c "$1" < /dev/null 2>&1; }
up_prod=0 up_staging=0
running prod && up_prod=1
running staging && up_staging=1

# per_project <id> <what> <fix> <function> [projects...]: run the function for each running project.
per_project() {
  local id=$1 what=$2 fix=$3 fn=$4; shift 4
  local probs='' waiting='' proj up out
  for proj in "$@"; do
    up=$up_prod; [ "$proj" = staging ] && up=$up_staging
    if [ "$up" = 1 ]; then
      out=$("$fn" "$proj")
      [ -z "$out" ] || probs="$probs $proj: $out"
    else
      waiting="$waiting $proj"
    fi
  done
  if [ -n "$probs" ]; then fail "$id" "$what" "${probs# }" "$fix"
  elif [ -n "$waiting" ]; then wait_ "$id" "$what" "waits for Postgres of$waiting to run"
  else pass "$id" "$what"; fi
}

d1() {
  local want='log_parameter_max_length=0 log_parameter_max_length_on_error=0 log_statement=ddl archive_mode=on archive_timeout=300 max_replication_slots=2 max_wal_senders=3 max_slot_wal_keep_size=2048 log_connections=on password_encryption=scram-sha-256 shared_preload_libraries= log_min_duration_statement=-1'
  local rows out='' kv name
  rows=$(q "$1" "SELECT name || '=' || setting FROM pg_settings WHERE name IN ('log_parameter_max_length','log_parameter_max_length_on_error','log_statement','archive_mode','archive_timeout','max_replication_slots','max_wal_senders','max_slot_wal_keep_size','log_connections','password_encryption','shared_preload_libraries','log_min_duration_statement')")
  for kv in $want; do
    name=${kv%%=*}
    grep -qxF "$kv" <<< "$rows" || out="$out $name is $(sed -n "s/^$name=//p" <<< "$rows" | head -1) (want ${kv#*=});"
  done
  echo "$out"
}
per_project D1 "postgres settings" "make the running Postgres use infra/postgres/postgresql.<project>.conf (the mounted fragment), then restart it" d1 prod staging

d2() {
  local ext
  ext=$(q "$1" "SELECT array_agg(extname ORDER BY extname) FROM pg_extension")
  [ "$ext" = '{plpgsql}' ] || echo "extensions are $ext (want only plpgsql);"
}
per_project D2 "extensions" "DROP EXTENSION the extra one as the superuser, and find out which migration added it" d2 prod staging

# D3: the backup login is refused from web, has no route from uploader, and works from backup (SECURITY C-79).
d3_probe() { # svc mode -> PROBE_OUT, PROBE_RC. The password is read inside the container from a read-only mount into a tmpfs pgpass.
  # backup and uploader are one-off runs (no container to join by name): the probe joins their only network, which is where the
  # service would stand. web is a running service, joined by its container id.
  local svc=$1 mode=$2 conn net
  case "$svc" in
    web)
      local wid
      wid=$(docker compose -p polycarpic-prod ps -q web < /dev/null 2> /dev/null | head -1)
      if [ -z "$wid" ]; then PROBE_OUT="no running web container of polycarpic-prod"; PROBE_RC=125; return; fi
      net="container:$wid" ;;
    backup) net=polycarpic-prod_backup-net ;;
    uploader) net=polycarpic-prod_upload-net ;;
  esac
  conn="host=postgres dbname=polycarpic user=poly_backup require_auth=scram-sha-256 connect_timeout=5"
  [ "$mode" = replication ] && conn="$conn replication=database"
  PROBE_OUT=$(docker run --rm --pull never --network "$net" --user 10004:10004 \
    --tmpfs /pgpass:rw,noexec,nosuid,size=1m,mode=1777 \
    -v "$ETC/secrets/backup/db_password_backup:/run/secrets/db_password_backup:ro" \
    "$PROBE_IMAGE" sh -c '
umask 077
printf "postgres:5432:*:poly_backup:%s\n" "$(cat /run/secrets/db_password_backup)" > /pgpass/.pgpass
PGPASSFILE=/pgpass/.pgpass; export PGPASSFILE
if [ "$2" = replication ]; then psql "$1" -tAc IDENTIFY_SYSTEM; else psql "$1" -tAc "select 1"; fi' probe "$conn" "$mode" 2>&1 < /dev/null)
  PROBE_RC=$?
}
d3() {
  local out='' svc mode first pgid t0 t1
  # The probe runs the image the running postgres container uses: no default tag, nothing pulled.
  pgid=$(docker compose -p polycarpic-prod ps -q postgres < /dev/null 2> /dev/null | head -1)
  PROBE_IMAGE=$([ -n "$pgid" ] && docker inspect --format '{{.Config.Image}}' "$pgid" 2> /dev/null)
  if [ -z "$PROBE_IMAGE" ]; then echo " cannot read the image of the running postgres container;"; return; fi
  t0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  for svc in web uploader backup; do
    for mode in sql replication; do
      d3_probe "$svc" "$mode"
      first=$(head -1 <<< "$PROBE_OUT" | cut -c1-160)
      if [ "$PROBE_RC" = 125 ]; then out="$out $svc probe could not start ($mode: $first) — the container or network it names is missing;"; continue; fi
      case "$svc" in
        web)
          if [ "$PROBE_RC" = 0 ]; then out="$out web connected as poly_backup ($mode; it must be refused by pg_hba.conf);"
          elif ! grep -qE 'no pg_hba.conf entry|pg_hba.conf rejects' <<< "$PROBE_OUT"; then out="$out web was not refused by pg_hba.conf ($mode: $first);"; fi ;;
        uploader)
          if [ "$PROBE_RC" = 0 ]; then out="$out uploader reached Postgres ($mode; it must have no route);"
          elif ! grep -qE 'could not translate host name|Name or service not known|Temporary failure in name resolution|No route to host|Network is unreachable' <<< "$PROBE_OUT"; then
            out="$out uploader failed for a reason other than name or route ($mode: $first);"; fi ;;
        backup)
          if [ "$PROBE_RC" != 0 ]; then out="$out backup could not connect as poly_backup ($mode: $first);"; fi ;;
      esac
    done
  done
  # POLY-98 R7: the probe connects as poly_backup, so its window goes into jobs.log, where `status` accounts for it.
  t1=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '%s %s provision-check-d3 %s\n' "$t0" "$t1" "$([ -z "$out" ] && echo ok || echo failed)" >> "$STATE/jobs.log" 2> /dev/null || true
  echo "$out"
}
if [ "$up_prod" = 1 ]; then
  per_project D3 "backup login reach" "compare pg_hba.conf and the compose networks with INFRA §2.2 and SECURITY C-79; db_password_backup belongs to the backup service only" d3 prod
else
  wait_ D3 "backup login reach" "waits for Postgres of prod to run"
fi

d4() {
  local s
  s=$(q "$1" "SELECT string_agg(slot_name, ',') FROM pg_replication_slots WHERE NOT temporary")
  [ -z "$s" ] || echo "replication slot(s) $s exist (a slot holds WAL until the disk fills);"
}
per_project D4 "replication slots" "drop the slot as the superuser: SELECT pg_drop_replication_slot('<name>'), then find what created it" d4 prod staging

d5() {
  local proj=$1 rows out='' role has
  rows=$(q "$proj" "SELECT rolname || ' ' || (rolpassword IS NOT NULL AND rolpassword LIKE 'SCRAM-SHA-256\$%') FROM pg_authid WHERE rolname IN ('poly_app','poly_auth','poly_worker','poly_migrator','poly_operator','poly_backup')")
  for role in poly_app poly_auth poly_worker poly_migrator poly_operator poly_backup; do
    has=$(sed -n "s/^$role //p" <<< "$rows" | head -1)
    if [ "$role" = poly_backup ] && [ "$proj" = staging ]; then
      [ "$has" != true ] || out="$out poly_backup has a verifier on staging (staging has no backup service);"
    else
      [ "$has" = true ] || out="$out $role has no SCRAM verifier;"
    fi
  done
  echo "$out"
}
per_project D5 "login roles" "run: sudo bash provision.sh --stage database --project <prod|staging>" d5 prod staging

d6() {
  local names=() n
  while IFS= read -r n; do [ -n "$n" ] && names+=("$n"); done < <(docker network ls --format '{{.Name}}' 2> /dev/null)
  docker network inspect "${names[@]}" 2> /dev/null | python3 -c '
import ipaddress, json, sys
fixed = {
    "polycarpic-prod_default": "10.201.1.0/24", "polycarpic-staging_default": "10.202.1.0/24",
    "polycarpic-edge-prod": "10.201.30.0/28", "polycarpic-edge-staging": "10.202.30.0/28",
    "polycarpic-prod_backup-net": "10.201.10.0/29", "polycarpic-prod_upload-net": "10.201.20.0/29"}
res = [ipaddress.ip_network("10.201.0.0/16"), ipaddress.ip_network("10.202.0.0/16")]
try:
    nets = json.load(sys.stdin)
except ValueError:
    print("docker network inspect printed no JSON;"); sys.exit(0)
for n in nets:
    name = n.get("Name", "")
    subs = [c.get("Subnet") for c in ((n.get("IPAM") or {}).get("Config") or []) if c.get("Subnet")]
    if name in fixed:
        if subs != [fixed[name]]:
            print("%s has subnet %s (want %s);" % (name, ",".join(subs) or "none", fixed[name]))
    else:
        for s in subs:
            if any(ipaddress.ip_network(s, strict=False).overlaps(r) for r in res):
                print("%s has subnet %s inside a reserved range;" % (name, s))
' | tr '\n' ' '
}
if [ "$up_prod" = 1 ] || [ "$up_staging" = 1 ]; then
  d6out=$(d6)
  report D6 "docker networks" "$d6out" "fix the subnet in infra/compose/*.yml and recreate the project, or remove the stray network (docker network rm <name>)"
else
  wait_ D6 "docker networks" "waits for Postgres of prod or staging to run"
fi

# ------------------------------------------------------------------ summary
if [ "$n_fail" -gt 0 ]; then
  echo "$n_fail CHECKS FAILED"
  exit 1
elif [ "$n_wait" -gt 0 ]; then
  echo "HOST CHECKS PASSED; $n_wait checks wait for the first deploy"
  exit 3
elif [ "$n_warn" -gt 0 ]; then
  echo "PASSED WITH $n_warn WARNINGS: $(join , "${warn_ids[@]}")"
  exit 0
else
  echo "ALL CHECKS PASSED"
  exit 0
fi
