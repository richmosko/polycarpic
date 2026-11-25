# docker:dind recipe I used for real-render measurements (devops-100), Mac host, Docker Desktop

```
docker run -d --rm --privileged --name poly100-render -v "$PWD:/repo:ro" docker:dind dockerd --host=unix:///var/run/docker.sock
sleep 8
docker exec poly100-render sh -c 'apk add -q python3 util-linux-misc setpriv shadow'
docker exec poly100-render sh -c '<commands as root: docker, docker compose, unshare, setpriv work; /repo is the checkout, read-only>'
docker rm -f poly100-render
```

What it has: root, dockerd inside, Docker CLI and the Compose plugin (Compose 5.x), busybox `setpriv` is replaced by util-linux's after `apk add setpriv` (busybox's has no --reuid), `unshare` works (privileged).
What it lacks: systemd (no `systemctl`), Ubuntu (it is Alpine/musl: `adduser` lists a user in its own group's member field; use `groupadd`-style entries by hand: `polycarpic-render:x:10020:10020::/nonexistent:/usr/sbin/nologin` and a group line with no members), `/etc/hosts` and `/etc/docker/certs.d` exist but the runner's `ubuntu-latest` differences (Compose version, apt, sudo) do not. For systemd or Ubuntu, a privileged `ubuntu:24.04` container needs systemd as PID 1 (`--privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw`, command `/lib/systemd/systemd`) plus Docker installed inside; I have not tried that.

Measured with it: `compose_guard.judge` as root with umask 077, real `unshare --net -- setpriv --reuid 10020 ...`, staging.yml, secrets dirs 0750 root:gid: JUDGED (see 2026-11-24-devops-100-guard-render-real-box.md).

# test_install_commit bad-hosts case

I no longer have its failure text: it appeared once in a whole-directory run on the Mac after G1/G2 (run before the umask fix in base.py), twice more in later whole runs, and passed alone every time and in the last whole run just now (0 failures). Treat it as order-dependent and unproven on my side; I did not capture the assertion.
