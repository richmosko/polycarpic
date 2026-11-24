# T-real in a privileged Ubuntu container on the Mac (qa-100), ~90-180 s per iteration

Container (systemd as PID 1, real inner Docker on overlay2 with the containerd snapshotter OFF: the default fails on whiteout files):
1. `docker run -d --name poly-treal --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock -v poly-treal-docker:/var/lib/docker ubuntu:24.04 sleep infinity`
2. `docker exec poly-treal apt-get update -qq`, then `docker exec -e DEBIAN_FRONTEND=noninteractive poly-treal apt-get install -y -qq --no-install-recommends docker.io docker-compose-v2 systemd systemd-sysv <the vcs package> python3 openssl curl ca-certificates util-linux procps iproute2 sudo xz-utils libatomic1` (plain `docker exec`, no `bash -c`: the worktree hook refuses shell text naming the vcs tool)
3. `docker commit poly-treal poly-treal-base`; `docker rm -f poly-treal`; run again from `poly-treal-base` with `/sbin/init` as the command and the same flags.
4. inner Docker: `/etc/docker/daemon.json` = `{"storage-driver":"overlay2","features":{"containerd-snapshotter":false}}`, stop docker docker.socket containerd, `rm -rf /var/lib/docker/* /var/lib/containerd/*`, start docker.
5. Compose: Ubuntu's docker-compose-v2 is 2.40 and renders `bind: {create_host_path: true}` on the plain render (the guard refuses it as guard-mount). Put v5.7.0 first: `/usr/local/lib/docker/cli-plugins/docker-compose` from the compose release (linux-aarch64).
6. Node 26 from nodejs.org (`node-v26.12.0-linux-arm64.tar.xz` into /usr/local), then `npm install --no-save vitest` in /work.
7. Images: `docker save polycarpic:ci polycarpic-postgres:ci polycarpic-caddy:ci | docker exec -i poly-treal docker load`. `polycarpic:ci` must be built from the CURRENT Dockerfile (the older one has no /release/infra): write `infra/release/images.env` with `infra/ci/images-env.sh` (all-zero digests), `docker build --build-arg GIT_COMMIT=<40 hex> -t polycarpic:ci .`, delete the artifact.
8. The tree: the committed HEAD (`archive HEAD | docker exec -i poly-treal tar -x -C /work`), made a repository again inside (`init`, `add -A`, `commit`), because the test installs from `archive HEAD`.
9. Run: `docker exec -e CI=true -e DEPLOY_REAL_LOG=/tmp/deploy-real.log -e POLY_APP_TEST_IMAGE=polycarpic:ci -w /work poly-treal npx vitest run -c tests/infra/vitest.deploy-real.config.ts`; between runs `bash infra/ci/deploy-real-undo.sh` (its `sed -i /etc/hosts` says "Device or resource busy" in a container: /etc/hosts is a bind mount there; a real runner is fine). Copy a changed harness in with `docker cp`.

Measured in it: Docker 29.1.3 prints `error: no such object: <name>` (lowercase) for `docker inspect` of a missing container.
