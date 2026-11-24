#!/usr/bin/env bash
# Undoes everything the T-real step (tests/infra/deploy-real) put on the CI runner (POLY-100 T-real, S38 b). Runs under `if: always()`, so it
# touches only what that test creates, every command tolerates "already gone", and a failure of one removal never stops the next.
# Names are the test's contract: containers, networks and users named `polycarpic-*`, the hosts line tagged `# poly-deploy-real`, the registry
# CA under /etc/docker/certs.d/ghcr.io, the fake `gh` at /usr/local/sbin/gh, and the trees below. The kept log is written elsewhere (RUNNER_TEMP).
set -u

as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

# containers and the local registry
ids=$(docker ps -aq --filter 'name=polycarpic' 2> /dev/null || true)
# shellcheck disable=SC2086 # the id list is meant to word-split
[ -z "$ids" ] || docker rm -f $ids > /dev/null 2>&1 || true
docker rm -f poly-deploy-real-registry > /dev/null 2>&1 || true
docker network ls -q --filter 'name=polycarpic' 2> /dev/null | while read -r n; do docker network rm "$n" > /dev/null 2>&1 || true; done

# the tmpfs data mount, then the trees
if mountpoint -q /srv/polycarpic 2> /dev/null; then as_root umount /srv/polycarpic || true; fi
as_root rm -rf /srv/polycarpic /opt/polycarpic /etc/polycarpic /var/lib/polycarpic /run/polycarpic /etc/docker/certs.d/ghcr.io || true

# the fake gh sits beside, never over, the real one
as_root rm -f /usr/local/sbin/gh || true

# the hosts line and the users
as_root sed -i '/# poly-deploy-real/d' /etc/hosts || true
for u in polycarpic-render polycarpic-ops; do
  if getent passwd "$u" > /dev/null 2>&1; then as_root userdel "$u" > /dev/null 2>&1 || true; fi
done
for g in polycarpic-render polycarpic-ops; do
  if getent group "$g" > /dev/null 2>&1; then as_root groupdel "$g" > /dev/null 2>&1 || true; fi
done
exit 0
