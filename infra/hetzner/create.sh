#!/usr/bin/env bash
# POLY-97 R1: create (or reconcile) the Hetzner server, firewall and data volume through the active hcloud context.
# Reads no token. Idempotent: a second run prints "no changes". Runs on the operator's laptop (bash 3.2 compatible; needs jq).
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
label='polycarpic=managed'
name='' location='' keyfile='' type=''

usage() { echo "usage: create.sh --name <name> --location <loc> --ssh-key <path.pub> --type <server-type>" >&2; }
die() { echo "create.sh: $*" >&2; exit 2; }

if [ -n "${HCLOUD_TOKEN+x}" ]; then
  die "HCLOUD_TOKEN is set in the environment; unset it and use an hcloud context (a token in the environment is visible to history and ps)"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --name) name=${2:-}; shift 2 ;;
    --location) location=${2:-}; shift 2 ;;
    --ssh-key) keyfile=${2:-}; shift 2 ;;
    --type) type=${2:-}; shift 2 ;;
    *) usage; die "unknown argument: $1" ;;
  esac
done

if [ -z "$type" ]; then
  usage
  echo "create.sh: --type is required. Hetzner renames its plans, so name one. 4 vCPU / 8 GB shared x86 types today:" >&2
  hcloud server-type list -o json \
    | jq -r '.[] | select(.cores == 4 and .memory == 8 and .cpu_type == "shared" and .architecture == "x86") | "  \(.name)  \(.description)"' >&2
  exit 2
fi
[ -n "$name" ] || { usage; die "--name is required"; }
[ -n "$location" ] || { usage; die "--location is required"; }
[ -n "$keyfile" ] || { usage; die "--ssh-key is required"; }
[ -r "$keyfile" ] || die "cannot read $keyfile"

# The key file is exactly one ssh-ed25519 line. Only "ssh-ed25519 <base64>" is used; the comment is dropped.
line1=$(sed -n '1p' "$keyfile" | tr -d '\r')
rest=$(sed -n '2,$p' "$keyfile" | tr -d ' \t\r\n')
key_re='^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( .*)?$'
[ -z "$rest" ] || die "$keyfile must hold one line"
[[ $line1 =~ $key_re ]] || die "$keyfile is not a single ssh-ed25519 public key line"
key=$(printf '%s' "$line1" | cut -d' ' -f1,2)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
printf '%s\n' "$key" > "$tmp/key.pub"
fp=$(ssh-keygen -l -E md5 -f "$tmp/key.pub" | awk '{print $2}' | sed 's/^MD5://')
sed "s|__SSH_PUBLIC_KEY__|$key|" "$here/cloud-init.yaml" > "$tmp/user-data.yaml"

cat > "$tmp/rules.json" <<'JSON'
[
 {"direction":"in","protocol":"tcp","port":"22","source_ips":["0.0.0.0/0","::/0"]},
 {"direction":"in","protocol":"tcp","port":"80","source_ips":["0.0.0.0/0","::/0"]},
 {"direction":"in","protocol":"tcp","port":"443","source_ips":["0.0.0.0/0","::/0"]}
]
JSON
norm='map({direction, protocol, port: (.port // ""), s: ((.source_ips // []) | sort), d: ((.destination_ips // []) | sort)}) | sort_by(.direction, .protocol, .port)'
want=$(jq -c "$norm" "$tmp/rules.json")

changes=0
change() { echo "change: $*"; changes=$((changes + 1)); }
exists() { echo "exists: $*"; }

# SSH key, matched by fingerprint (any name).
keys=$(hcloud ssh-key list -o json)
keyname=$(printf '%s' "$keys" | jq -r --arg fp "$fp" '[.[] | select(.fingerprint == $fp)][0].name // empty')
if [ -n "$keyname" ]; then
  exists "ssh key $keyname"
else
  keyname=$name
  change "hcloud ssh-key create --name $name"
  hcloud ssh-key create --name "$name" --public-key-from-file "$tmp/key.pub" --label "$label" > /dev/null
fi

# Firewall: three inbound tcp rules; replaced on any drift.
fws=$(hcloud firewall list -o json --selector "$label")
fwjson=$(printf '%s' "$fws" | jq -c --arg n "$name" '[.[] | select(.name == $n)][0] // empty')
if [ -z "$fwjson" ]; then
  change "hcloud firewall create --name $name (22,80,443 in)"
  hcloud firewall create --name "$name" --label "$label" --rules-file "$tmp/rules.json" > /dev/null
else
  have=$(printf '%s' "$fwjson" | jq -c ".rules | $norm")
  if [ "$have" = "$want" ]; then
    exists "firewall $name"
  else
    was=$(printf '%s' "$fwjson" | jq -r '[.rules[] | (.port // .protocol)] | join(",")')
    change "firewall rules reset (was: $was)"
    hcloud firewall replace-rules "$name" --rules-file "$tmp/rules.json" > /dev/null
  fi
fi

# Server: the firewall is attached at creation, so it is never reachable unfirewalled.
servers=$(hcloud server list -o json --selector "$label")
sid=$(printf '%s' "$servers" | jq -r --arg n "$name" '[.[] | select(.name == $n)][0].id // empty')
created=0
if [ -z "$sid" ]; then
  change "hcloud server create --name $name --type $type --image ubuntu-24.04 --location $location --firewall $name"
  hcloud server create --name "$name" --type "$type" --image ubuntu-24.04 --location "$location" \
    --ssh-key "$keyname" --firewall "$name" --user-data-from-file "$tmp/user-data.yaml" --label "$label" > /dev/null
  created=1
else
  exists "server $name"
  if ! hcloud firewall list -o json --selector "$label" \
    | jq -e --arg n "$name" --argjson id "$sid" '[.[] | select(.name == $n)][0].applied_to // [] | map(.server.id) | index($id) != null' > /dev/null; then
    change "hcloud firewall apply-to-resource $name --type server --server $name"
    hcloud firewall apply-to-resource "$name" --type server --server "$name" > /dev/null
  fi
fi

# Data volume: 20 GB, attached, never formatted here (provision.sh formats it LUKS2).
vols=$(hcloud volume list -o json --selector "$label")
vjson=$(printf '%s' "$vols" | jq -c --arg n "$name-data" '[.[] | select(.name == $n)][0] // empty')
if [ -z "$vjson" ]; then
  change "hcloud volume create --name $name-data --size 20 --server $name"
  hcloud volume create --name "$name-data" --size 20 --server "$name" --label "$label" > /dev/null
  created=1
elif [ "$(printf '%s' "$vjson" | jq -r '.server // "none"')" = none ]; then
  change "hcloud volume attach $name-data --server $name"
  hcloud volume attach "$name-data" --server "$name" > /dev/null
else
  exists "volume $name-data"
fi

# Hetzner applies the union of every firewall on a server: one attached in the console opens ports without touching ours.
# Detach (never delete) any firewall on the server that is not ours.
sj=$(hcloud server describe "$name" -o json)
all_fw=$(hcloud firewall list -o json)
our_id=$(printf '%s' "$all_fw" | jq -r --arg n "$name" '[.[] | select(.name == $n)][0].id // empty')
for fid in $(printf '%s' "$sj" | jq -r '.public_net.firewalls[]?.id'); do
  [ "$fid" = "$our_id" ] && continue
  other=$(printf '%s' "$all_fw" | jq -r --argjson id "$fid" '[.[] | select(.id == $id)][0].name // empty')
  [ -n "$other" ] || continue
  change "firewall detached ($other)"
  hcloud firewall remove-from-resource "$other" --type server --server "$name" > /dev/null
done

# Addresses.
sj=$(hcloud server describe "$name" -o json)
echo "IPv4: $(printf '%s' "$sj" | jq -r '.public_net.ipv4.ip')"
echo "IPv6: $(printf '%s' "$sj" | jq -r '.public_net.ipv6.ip')"

cat <<MSG
Remove the API token now, in this sitting. With the server created, the token can snapshot both disks, and the LUKS key is on the root disk:
  1. hcloud context delete <context-name>
  2. delete the token in the Hetzner console (Security -> API tokens)
MSG

if [ "$created" = 1 ]; then
  echo "created: server, firewall (22,80,443 in), volume 20 GB"
elif [ "$changes" = 0 ]; then
  echo "no changes"
else
  echo "changed: $changes"
fi
