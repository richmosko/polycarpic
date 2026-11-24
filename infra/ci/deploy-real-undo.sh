#!/usr/bin/env bash
# Undoes everything the T-real step (tests/infra/deploy-real) put on the CI runner (POLY-100 T-real, S38 b). Runs under `if: always()`, so it
# touches only what that test creates (the list is the harness's own header), every command tolerates "already gone", and a failure of one
# removal never stops the next. The kept log is written elsewhere (RUNNER_TEMP).
set -u

as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

# the systemd timer and service, if the run enabled or started them (systemctl is not faked): stopped, the units removed, systemd reloaded,
# all before the fake gh goes, and on a failed run too
as_root systemctl disable --now polycarpic-deploy@staging.timer > /dev/null 2>&1 || true
as_root systemctl stop polycarpic-deploy@staging.service > /dev/null 2>&1 || true
as_root rm -f /etc/systemd/system/polycarpic-deploy@.timer /etc/systemd/system/polycarpic-deploy@.service || true
as_root systemctl daemon-reload > /dev/null 2>&1 || true

# containers, the local registry, the staging project, the edge network
as_root docker rm -f poly-deploy-real-registry > /dev/null 2>&1 || true
ids=$(docker ps -aq --filter 'name=polycarpic-staging' 2> /dev/null || true)
# shellcheck disable=SC2086 # the id list is meant to word-split
[ -z "$ids" ] || docker rm -f -v $ids > /dev/null 2>&1 || true
docker network rm polycarpic-edge-staging > /dev/null 2>&1 || true

# the images the test pushed or built for itself
docker images --format '{{.Repository}}:{{.Tag}}' 2> /dev/null | grep -E '^(ghcr\.io/richmosko/|polycarpic-deploy-real-)' | while read -r img; do
  docker rmi -f "$img" > /dev/null 2>&1 || true
done

# the runner's /opt, if the harness changed it for the tool's trust check: back to the `<mode> <uid>:<gid>` it recorded first
if [ -r /run/poly-deploy-real/opt.orig ]; then
  read -r orig_mode orig_owner < /run/poly-deploy-real/opt.orig || true
  if [[ "${orig_mode:-}" =~ ^[0-7]{3,4}$ && "${orig_owner:-}" =~ ^[0-9]+:[0-9]+$ ]]; then
    as_root chown "$orig_owner" /opt || true
    as_root chmod "$orig_mode" /opt || true
  fi
fi

# the data mount, then the trees
if mountpoint -q /srv/polycarpic 2> /dev/null; then as_root umount /srv/polycarpic || true; fi
as_root rm -rf /srv/polycarpic /opt/polycarpic /etc/polycarpic /var/lib/polycarpic /run/polycarpic /run/poly-deploy-real /etc/docker/certs.d/ghcr.io || true

# the fake gh and the installed dispatcher sit beside, never over, the real tools
as_root rm -f /usr/local/sbin/gh /usr/local/sbin/polycarpic-ops || true

# the hosts line, the users and their groups
as_root sed -i '/# poly-deploy-real/d' /etc/hosts || true
for u in pdr-postgres pdr-web pdr-worker pdr-migrate pdr-operator pdr-auth polycarpic-render; do
  if getent passwd "$u" > /dev/null 2>&1; then as_root userdel "$u" > /dev/null 2>&1 || true; fi
  if getent group "$u" > /dev/null 2>&1; then as_root groupdel "$u" > /dev/null 2>&1 || true; fi
done
exit 0
