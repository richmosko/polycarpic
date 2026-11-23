#!/usr/bin/env bash
# POLY-97 R5: provision the box. Run as root on the box, from a verified checkout copied to /tmp (INFRA §7.1 step 11).
#   provision.sh --stage host --target hetzner --domain <d> [--mail-from <addr>]
#   provision.sh --stage database --project prod|staging
# Idempotent: a second run changes nothing and says so. No secret is printed, logged, or put in argv or the environment (R10).
set -euo pipefail

ETC=/etc/polycarpic
DATA=/srv/polycarpic
STATE=/var/lib/polycarpic/state
MAPPER=polycarpic-data
DOCKER_KEY_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
VOL_DEVICE_GLOB='/dev/disk/by-id/scsi-0HC_Volume_*'

stage='' target='' domain='' mail_from='' project='' b2_endpoint='' b2_endpoint_set=0
changes=0

die() { echo "provision.sh: $*" >&2; exit "${2:-1}"; }
usage() { echo "usage: provision.sh --stage host --target hetzner --domain <d> [--mail-from <addr>] [--b2-endpoint <url>] | --stage database --project prod|staging" >&2; exit 2; }
change() { echo "change: $*"; changes=$((changes + 1)); }

while [ $# -gt 0 ]; do
  case "$1" in
    --stage) stage=${2:-}; shift 2 ;;
    --target) target=${2:-}; shift 2 ;;
    --domain) domain=${2:-}; shift 2 ;;
    --mail-from) mail_from=${2:-}; shift 2 ;;
    --b2-endpoint) b2_endpoint=${2:-}; b2_endpoint_set=1; shift 2 ;;
    --project) project=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[ "$(id -u)" = 0 ] || die "run as root (sudo bash provision.sh ...)" 2

# Service gids (F6, POLY-146). The same set the compose files mount secrets for.
gid_of() {
  case "$1" in
    postgres) echo 999 ;; web) echo 10001 ;; worker) echo 10002 ;; migrate) echo 10003 ;; backup) echo 10004 ;;
    uploader) echo 10005 ;; operator) echo 10006 ;; auth) echo 10007 ;; caddy) echo 10010 ;;
    *) die "unknown service $1" ;;
  esac
}
PROD_SERVICES="postgres web worker migrate backup uploader operator auth caddy"
STAGING_SERVICES="postgres web worker migrate operator auth"
# service/file pairs generated here (32 random bytes, base64, written once, never overwritten).
PROD_GENERATED="postgres/db_superuser_password web/db_password_app auth/db_password_auth auth/auth_secret worker/db_password_worker migrate/db_password_migrator operator/db_password_operator backup/db_password_backup"
STAGING_GENERATED="postgres/db_superuser_password web/db_password_app auth/db_password_auth auth/auth_secret worker/db_password_worker migrate/db_password_migrator operator/db_password_operator"

# ---------------------------------------------------------------- file helpers

# put_file <path> <mode> <content>: write only when the content differs.
put_file() {
  local path=$1 mode=$2 content=$3
  if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ]; then
    [ "$(stat -c %a "$path")" = "$(printf '%o' "0$mode")" ] || chmod "$mode" "$path"
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$content" > "$path.new"
  chmod "$mode" "$path.new"
  mv "$path.new" "$path"
  change "wrote $path"
}

# ensure_dir <path> <mode> <uid:gid>: create when missing; fix owner and mode when they differ.
ensure_dir() {
  local path=$1 mode=$2 owner=$3
  if [ ! -d "$path" ]; then
    install -d -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$path"
    change "created $path"
    return 0
  fi
  [ "$(stat -c %u:%g "$path")" = "$owner" ] || { chown "$owner" "$path"; change "owner of $path set to $owner"; }
}

ensure_line() { # file fixed-string line
  grep -qxF "$2" "$1" 2>/dev/null && return 0
  printf '%s\n' "$2" >> "$1"
  change "added a line to $1"
}

# ---------------------------------------------------------------- host stage

validate_host_args() {
  [ "$target" = hetzner ] || die "--target hetzner is required (the home box is POLY-120)" 2
  [[ $domain =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || die "--domain must be a domain name, e.g. example.com" 2
  if [ "$b2_endpoint_set" = 1 ]; then
    [[ $b2_endpoint =~ ^https://s3\.[a-z0-9-]+\.backblazeb2\.com$ ]] || die "--b2-endpoint must be https://s3.<region>.backblazeb2.com" 2
  fi
  if [ -n "$mail_from" ]; then
    check_mail_from "$mail_from" || die "--mail-from must be an address under mail.$domain (the domain Resend verified; DMARC aligns there)" 2
  fi
}

check_mail_from() {
  local addr=$1
  addr=${addr##*<}; addr=${addr%%>*}
  [[ $addr =~ ^[A-Za-z0-9._+-]+@mail\.${domain//./\\.}$ ]]
}

find_volume_device() {
  local matches=()
  shopt -s nullglob
  # shellcheck disable=SC2206
  matches=( $VOL_DEVICE_GLOB )
  shopt -u nullglob
  if [ ${#matches[@]} -ne 1 ]; then
    echo "provision.sh: expected exactly one device matching $VOL_DEVICE_GLOB, found ${#matches[@]}: ${matches[*]:-none}" >&2
    exit 1
  fi
  DEVICE=${matches[0]}
}

# volume_state: luks | empty | foreign. Read only: wipefs runs with --no-act.
volume_state() {
  if cryptsetup isLuks "$DEVICE" 2> /dev/null; then echo luks; return; fi
  local sig
  sig=$(wipefs --no-act "$DEVICE" 2> /dev/null || true)
  if [ -z "$sig" ] && ! blkid "$DEVICE" > /dev/null 2>&1; then echo empty; else echo foreign; fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y > /dev/null
  apt-get install -y --no-install-recommends ca-certificates curl gnupg jq acl age cryptsetup unattended-upgrades python3 > /dev/null
}

install_docker() {
  local keyring=/etc/apt/keyrings/docker.gpg list=/etc/apt/sources.list.d/docker.list codename arch
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  arch=$(dpkg --print-architecture)
  if [ ! -f "$keyring" ] || [ ! -f "$list" ]; then
    local tmp fpr
    tmp=$(mktemp)
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$tmp"
    fpr=$(gpg --show-keys --with-colons "$tmp" | awk -F: '$1 == "fpr" { print $10; exit }')
    if [ "$fpr" != "$DOCKER_KEY_FPR" ]; then
      rm -f "$tmp"
      die "Docker's apt key fingerprint is $fpr, expected $DOCKER_KEY_FPR; nothing installed"
    fi
    install -d -m 0755 /etc/apt/keyrings
    gpg --dearmor < "$tmp" > "$keyring"
    chmod 0644 "$keyring"
    rm -f "$tmp"
    echo "deb [arch=$arch signed-by=$keyring] https://download.docker.com/linux/ubuntu $codename stable" > "$list"
    change "added Docker's apt repository (key fingerprint verified)"
  fi
  apt-get update -y > /dev/null
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null
}

write_daemon_json() {
  install -d -m 0755 /etc/docker
  local want='{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "default-address-pools": [ { "base": "10.200.0.0/16", "size": 24 } ],
  "userland-proxy": false
}'
  if [ -f /etc/docker/daemon.json ] && [ "$(cat /etc/docker/daemon.json)" = "$want" ]; then return 0; fi
  printf '%s\n' "$want" > /etc/docker/daemon.json
  chmod 0644 /etc/docker/daemon.json
  change "wrote /etc/docker/daemon.json"
  DAEMON_CHANGED=1
}

unattended_upgrades() {
  put_file /etc/apt/apt.conf.d/20auto-upgrades 0644 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";'
  put_file /etc/apt/apt.conf.d/52polycarpic-unattended 0644 'Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";'
}

no_swap() {
  if [ -n "$(swapon --show 2> /dev/null | grep -v '^NAME' || true)" ]; then
    swapoff -a
    change "swap turned off"
  fi
  if grep -qE '^[^#]*[[:space:]]swap[[:space:]]' /etc/fstab 2> /dev/null; then
    sed -i -E '/^[^#]*[[:space:]]swap[[:space:]]/d' /etc/fstab
    change "swap removed from /etc/fstab"
  fi
}

data_volume() {
  local state=$1 key=$ETC/luks.key
  install -d -m 0755 "$ETC"
  mkdir -p "$DATA"
  local mounted
  mounted=$(findmnt -n -o SOURCE "$DATA" 2> /dev/null || true)
  if [ "$mounted" = "/dev/mapper/$MAPPER" ]; then
    :
  else
    local formatted=0
    if [ "$state" = empty ]; then
      if [ ! -e "$key" ]; then
        (umask 0377; head -c 64 /dev/urandom > "$key")
        chmod 0400 "$key"
        change "created $key (root 0400): the only way to open the volume; it lives on the root disk"
      fi
      cryptsetup luksFormat --type luks2 --batch-mode --key-file "$key" "$DEVICE"
      change "formatted $DEVICE as LUKS2"
      formatted=1
    fi
    if [ ! -e "/dev/mapper/$MAPPER" ]; then
      cryptsetup open --type luks2 --key-file "$key" "$DEVICE" "$MAPPER"
      change "opened $DEVICE as $MAPPER"
    fi
    if [ "$formatted" = 1 ]; then
      mkfs.ext4 -q -L "$MAPPER" "/dev/mapper/$MAPPER"
      change "made an ext4 filesystem on /dev/mapper/$MAPPER"
    fi
    mount "/dev/mapper/$MAPPER" "$DATA"
    change "mounted /dev/mapper/$MAPPER at $DATA"
  fi
  [ -e /etc/crypttab ] || : > /etc/crypttab
  ensure_line /etc/crypttab "$MAPPER $DEVICE $key luks"
  ensure_line /etc/fstab "/dev/mapper/$MAPPER $DATA ext4 defaults,nofail 0 2"
}

# acl_dir <path> <uid:gid>: 0700 for the owner; uid 10005 lists and reads through access and default ACLs (r-x), and only root
# deletes (POLY-99 C3). Each directory has an .inflight/ with the same owner: files are born there with a default `u:10005:r--`
# and no access entry for 10005, so the uploader cannot enter it.
# Never chmod a spool file after creating it: a chmod rewrites the ACL mask and takes away the uploader's read.
acl_dir() {
  local path=$1 owner=$2 before after
  ensure_dir "$path" 0700 "$owner"
  ensure_dir "$path/.inflight" 0700 "$owner"
  before=$(getfacl -cp "$path"; getfacl -cp "$path/.inflight")
  setfacl -m u:10005:r-x "$path"
  setfacl -d -m u::rwx,g::---,o::---,u:10005:r-x "$path"
  setfacl -x u:10005 "$path/.inflight"
  setfacl -d -m u::rwx,g::---,o::---,u:10005:r-- "$path/.inflight"
  after=$(getfacl -cp "$path"; getfacl -cp "$path/.inflight")
  [ "$before" = "$after" ] || change "ACL of $path set (10005 r-x, .inflight default r--)"
}

data_dirs() {
  [ "$(stat -c %a "$DATA")" = 755 ] || chmod 0755 "$DATA"
  local d
  for d in pg-prod pg-staging; do
    ensure_dir "$DATA/$d" 0700 999:999
    [ "$(stat -c %a "$DATA/$d")" = 700 ] || chmod 0700 "$DATA/$d"
  done
  ensure_dir "$DATA/spool" 0755 0:0
  acl_dir "$DATA/spool/wal" 999:999
  acl_dir "$DATA/spool/dump" 10004:10004
  acl_dir "$DATA/spool/premigration" 10004:10004
}

state_files() {
  ensure_dir /var/lib/polycarpic 0755 0:0
  ensure_dir "$STATE" 0755 0:0
  local f
  # Root writes every record the status and the restore read; no container mounts any of them (POLY-99 R9).
  for f in last-upload jobs.log spool.sha256; do
    if [ ! -e "$STATE/$f" ]; then : > "$STATE/$f"; change "created $STATE/$f"; fi
    [ "$(stat -c %u:%g "$STATE/$f")" = "0:0" ] || { chown 0:0 "$STATE/$f"; change "owner of $STATE/$f set to root"; }
    [ "$(stat -c %a "$STATE/$f")" = 644 ] || chmod 0644 "$STATE/$f"
  done
  if [ -f "$STATE/last-dump" ] && [ ! -s "$STATE/last-dump" ]; then rm -f "$STATE/last-dump"; change "removed the unused $STATE/last-dump"; fi
}

# ops.conf: root:root 0644. The endpoint line is ours; polycarpic-ops writes the bucket line and keeps this one.
ops_endpoint() {
  local conf=$ETC/ops.conf other want current=''
  [ -f "$conf" ] && current=$(cat "$conf")
  other=$(printf '%s\n' "$current" | grep -v '^B2_S3_ENDPOINT=' | grep -v '^$' || true)
  want=$(printf '%s\n%s\n' "$other" "B2_S3_ENDPOINT=$b2_endpoint" | grep -v '^$')
  if [ ! -f "$conf" ] || [ "$current" != "$want" ]; then
    printf '%s\n' "$want" > "$conf.new"
    chmod 0644 "$conf.new"
    chown 0:0 "$conf.new"
    mv "$conf.new" "$conf"
    change "ops.conf B2_S3_ENDPOINT set"
  fi
  [ "$(stat -c %a "$conf")" = 644 ] || chmod 0644 "$conf"
}

# The backup and uploader units are installed, not enabled: the first deploy enables the timers once images.env exists.
install_units() {
  local here src u reload=0
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  src=$here/backup/systemd
  for u in polycarpic-backup.service polycarpic-backup.timer polycarpic-uploader.service polycarpic-uploader.timer; do
    [ -f "$src/$u" ] || die "$src/$u not found"
    if ! cmp -s "$src/$u" "/etc/systemd/system/$u"; then
      install -m 0644 -o 0 -g 0 "$src/$u" "/etc/systemd/system/$u"
      change "installed /etc/systemd/system/$u"
      reload=1
    fi
  done
  if [ "$reload" = 1 ]; then systemctl daemon-reload; fi
}

secrets_for() { # root services generated
  local root=$1 services=$2 generated=$3 svc pair f gid
  ensure_dir "$root" 0700 0:0
  [ "$(stat -c %a "$root")" = 700 ] || chmod 0700 "$root"
  for svc in $services; do
    gid=$(gid_of "$svc")
    ensure_dir "$root/$svc" 0750 "0:$gid"
    [ "$(stat -c %a "$root/$svc")" = 750 ] || chmod 0750 "$root/$svc"
  done
  for pair in $generated; do
    svc=${pair%%/*}; f=$root/$pair; gid=$(gid_of "$svc")
    if [ ! -e "$f" ]; then
      (umask 0377; head -c 32 /dev/urandom | base64 > "$f")
      change "generated ${f#"$ETC"/}"
    fi
    [ "$(stat -c %u:%g "$f")" = "0:$gid" ] || chown "root:$gid" "$f"
    [ "$(stat -c %a "$f")" = 440 ] || chmod 0440 "$f"
  done
}

host_secrets() { # secrets root reads and no service mounts (heartbeat_url): root:root 0700 directory, root:root 0400 files
  local root=$ETC/secrets old=$ETC/secrets/uploader/heartbeat_url new=$ETC/secrets/host/heartbeat_url
  ensure_dir "$root/host" 0700 0:0
  [ "$(stat -c %a "$root/host")" = 700 ] || chmod 0700 "$root/host"
  if [ -f "$old" ] && [ ! -e "$new" ]; then
    mv "$old" "$new"
    change "moved secrets/uploader/heartbeat_url to secrets/host/heartbeat_url"
  fi
  if [ -f "$new" ]; then
    [ "$(stat -c %u:%g "$new")" = "0:0" ] || chown 0:0 "$new"
    [ "$(stat -c %a "$new")" = 400 ] || chmod 0400 "$new"
  fi
}

host_env() { # file instance origin
  local file=$1 instance=$2 origin=$3 from=$4
  put_file "$file" 0644 "TLS_MODE=real-domain
PUBLIC_ORIGIN=$origin
MAIL_FROM=\"$from\"
POLY_INSTANCE=$instance"
}

effective_mail_from() {
  if [ -n "$mail_from" ]; then echo "$mail_from"; return; fi
  local cur=''
  if [ -f "$ETC/host.env" ]; then
    cur=$(sed -n 's/^MAIL_FROM=//p' "$ETC/host.env" | head -1 | sed -e 's/^"//' -e 's/"$//')
  fi
  if [ -n "$cur" ] && check_mail_from "$cur"; then echo "$cur"; else echo "Polycarpic <no-reply@mail.$domain>"; fi
}

check_accounts() {
  local bad='' line user gid
  while IFS=: read -r user _ _ gid _; do
    [ "$user" = root ] && continue
    if [ "$gid" = 999 ] || { [ "$gid" -ge 10001 ] && [ "$gid" -le 10010 ]; }; then bad="$bad $user(primary gid $gid)"; fi
  done < <(getent passwd)
  while IFS= read -r line; do
    local name=${line%%:*} g rest
    rest=${line#*:*:}; g=${rest%%:*}; rest=${rest#*:}
    if [ "$g" = 999 ] || { [ "$g" -ge 10001 ] && [ "$g" -le 10010 ]; } || [ "$name" = docker ]; then
      for user in ${rest//,/ }; do [ "$user" = root ] || bad="$bad $user(in group $name, gid $g)"; done
    fi
  done < <(getent group)
  [ -z "$bad" ] || die "host accounts hold a service gid or the docker group:$bad"
}

stage_host() {
  validate_host_args
  find_volume_device
  local state
  state=$(volume_state)
  [ "$state" != foreign ] || die "$DEVICE holds data but no LUKS header; refusing to touch it. Detach it or wipe it by hand if it is meant to be reused"
  local mf
  mf=$(effective_mail_from)

  DAEMON_CHANGED=0
  write_daemon_json
  install_packages
  install_docker
  systemctl enable --now docker > /dev/null 2>&1 || true
  [ "$DAEMON_CHANGED" = 0 ] || systemctl restart docker
  unattended_upgrades
  systemctl enable --now unattended-upgrades > /dev/null 2>&1 || true
  no_swap
  data_volume "$state"
  data_dirs
  state_files
  secrets_for "$ETC/secrets" "$PROD_SERVICES" "$PROD_GENERATED"
  host_secrets
  if [ "$b2_endpoint_set" = 1 ]; then ops_endpoint; fi
  install_units
  secrets_for "$ETC/staging-secrets" "$STAGING_SERVICES" "$STAGING_GENERATED"
  host_env "$ETC/host.env" polycarpic-prod "https://app.$domain" "$mf"
  host_env "$ETC/staging-host.env" polycarpic-staging "https://staging.$domain" "$mf"
  check_accounts
  if [ "$changes" = 0 ]; then echo "host stage: no changes"; else echo "host stage: $changes changes"; fi
}

# ---------------------------------------------------------------- database stage

# The SCRAM-SHA-256 verifier is computed here, so Postgres never sees a plaintext password (R5).
emit_alters() { # root pair...
  python3 - "$@" <<'PY'
import base64, hashlib, hmac, os, sys
root = sys.argv[1]
for pair in sys.argv[2:]:
    role, rel = pair.split(":", 1)
    with open(os.path.join(root, rel), "rb") as fh:
        pw = fh.read().rstrip(b"\n")
    salt = os.urandom(16)
    it = 4096
    salted = hashlib.pbkdf2_hmac("sha256", pw, salt, it)
    ck = hmac.new(salted, b"Client Key", "sha256").digest()
    sk = hmac.new(salted, b"Server Key", "sha256").digest()
    b = lambda x: base64.b64encode(x).decode()
    print("ALTER ROLE %s PASSWORD 'SCRAM-SHA-256$%d:%s$%s:%s';" % (role, it, b(salt), b(hashlib.sha256(ck).digest()), b(sk)))
PY
}

stage_database() {
  case "$project" in prod | staging) ;; *) usage ;; esac
  local root=$ETC/secrets pairs=() roles_sql here
  [ "$project" = staging ] && root=$ETC/staging-secrets
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  roles_sql=$here/roles.sql
  [ -f "$roles_sql" ] || roles_sql=$here/../packages/db/sql/roles.sql
  [ -f "$roles_sql" ] || die "roles.sql not found next to this script"
  pairs=(poly_app:web/db_password_app poly_auth:auth/db_password_auth poly_worker:worker/db_password_worker
    poly_migrator:migrate/db_password_migrator poly_operator:operator/db_password_operator)
  # poly_backup has a password only where the backup service exists (prod).
  [ "$project" = prod ] && pairs+=(poly_backup:backup/db_password_backup)

  local dc=(docker compose -p "polycarpic-$project")
  "${dc[@]}" ps --status running --services < /dev/null | grep -qx postgres \
    || die "Postgres of $project is not running; start it first (the first deploy does)"

  "${dc[@]}" exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U postgres -d polycarpic < "$roles_sql" > /dev/null \
    || die "roles.sql failed on $project"
  echo "roles.sql applied on $project"

  local errf rc=0
  errf=$(mktemp /dev/shm/provision-err.XXXXXX)
  {
    echo "SET log_statement = 'none';"
    echo "SET log_min_error_statement = 'panic';"
    emit_alters "$root" "${pairs[@]}"
  } | "${dc[@]}" exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U postgres -d polycarpic > /dev/null 2> "$errf" || rc=$?
  sed -E 's/SCRAM-SHA-256\$[^ '"'"']*/[verifier]/g' "$errf" >&2
  rm -f "$errf"
  [ "$rc" = 0 ] || die "setting the login passwords failed on $project (exit $rc)"
  echo "database stage ($project): ${#pairs[@]} login passwords set"
}

case "$stage" in
  host) stage_host ;;
  database) stage_database ;;
  *) usage ;;
esac
