#!/usr/bin/env python3
"""Applies the `users:` and `write_files:` of a cloud-init file to this container, the way cloud-init would at first
boot (the real cloud-init cannot boot here). Only those two keys are applied; the harness contract (test-plan.md) is
that cloud-init.yaml keeps the polyops user in `users:` and the sshd and sudoers drop-ins in `write_files:`."""
import os, subprocess, sys, yaml

cfg = yaml.safe_load(open(sys.argv[1]))
for u in cfg.get("users", []):
    if u == "default" or not isinstance(u, dict):
        continue
    name = u["name"]
    cmd = ["useradd", "-m", "-s", u.get("shell", "/bin/bash")]
    if u.get("groups"):
        g = u["groups"]
        cmd += ["-G", g if isinstance(g, str) else ",".join(g)]
    subprocess.run(cmd + [name], check=True)
    keys = u.get("ssh_authorized_keys", [])
    if keys:
        d = f"/home/{name}/.ssh"
        os.makedirs(d, mode=0o700, exist_ok=True)
        open(d + "/authorized_keys", "w").write("\n".join(keys) + "\n")
        subprocess.run(["chown", "-R", f"{name}:{name}", d], check=True)
        os.chmod(d + "/authorized_keys", 0o600)
    sudo = u.get("sudo")
    if sudo:
        for s in ([sudo] if isinstance(sudo, str) else sudo):
            open(f"/etc/sudoers.d/90-cloud-init-{name}", "a").write(f"{name} {s}\n")
        os.chmod(f"/etc/sudoers.d/90-cloud-init-{name}", 0o440)
for f in cfg.get("write_files", []):
    os.makedirs(os.path.dirname(f["path"]), exist_ok=True)
    open(f["path"], "w").write(f.get("content", ""))
    os.chmod(f["path"], int(str(f.get("permissions", "0644")), 8))
    if f.get("owner"):
        subprocess.run(["chown", f["owner"], f["path"]], check=True)
