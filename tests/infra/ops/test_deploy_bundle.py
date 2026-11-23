"""POLY-100 G2: the release bundle is data (R4; T6, S7 inputs, seceng's size and entry-type cases) and ctx.run_bytes' real cap."""
import io
import os
import subprocess
import sys
import tarfile
import time
import unittest
from pathlib import Path

from base import OPS, REPO, ctx_class
from deploy_base import REGISTRY, DeployTest, digest, hexd

CAP = 64 << 20
MANIFEST = ["infra/compose/prod.yml", "infra/compose/staging.yml", "infra/compose/edge.yml", "infra/caddy/Caddyfile", "infra/postgres-major",
            "infra/backup/backup.sh", "infra/backup/upload.sh"]


def sibling_digests(seed=""):
    return {n: digest("sib-" + n + seed) for n in ("postgres", "tools", "caddy")}


def images_env_text(sibs=None):
    s = sibs or sibling_digests()
    return "".join("POLY_%s_IMAGE=ghcr.io/richmosko/polycarpic-%s@%s\n" % (n.upper(), n, d) for n, d in sorted(s.items()))


def good_files(env=None):
    files = {p: (REPO / p).read_bytes() for p in MANIFEST}
    for f in sorted((REPO / "infra" / "postgres").iterdir()):
        if f.is_file() and f.suffix in (".conf", ".sh"):
            files["infra/postgres/" + f.name] = f.read_bytes()
    files["infra/release/images.env"] = (env or images_env_text()).encode()
    return files


def make_tar(files, extra=()):
    """files: {path: bytes} regular members (0644, scripts 0755); extra: callables(tarfile) that add odd members."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as t:
        for name, data in sorted(files.items()):
            ti = tarfile.TarInfo(name)
            ti.size, ti.mode = len(data), 0o755 if name.endswith(".sh") else 0o644
            t.addfile(ti, io.BytesIO(data))
        for fn in extra:
            fn(t)
    return buf.getvalue()


def member(name, typ=tarfile.REGTYPE, mode=0o644, link="", data=b"", size=None):
    def add(t):
        ti = tarfile.TarInfo(name)
        ti.type, ti.mode, ti.linkname = typ, mode, link
        ti.size = len(data) if size is None else size
        t.addfile(ti, io.BytesIO(data) if typ == tarfile.REGTYPE else None)
    return add


class BundleBase(DeployTest):
    def candidate(self, tar):
        w = self.world
        x = digest("x")
        w.image("polycarpic", x, w.commit_b, bundle=tar)
        w.attested.add((x, w.commit_b))
        for n, d in sibling_digests().items():
            w.image("polycarpic-" + n, d, w.commit_b)
            w.attested.add((d, w.commit_b))
        w.staging_run(w.commit_b, x)
        return x

    def releases(self):
        d = self.host.p("/opt/polycarpic/releases")
        own = "sha256-" + self.current_digest.split(":")[1]  # the seeded `current`'s release (postgres-major only)
        return sorted(n for n in os.listdir(str(d)) if n != own) if d.exists() else []

    def refused_bundle(self, tar):
        x = self.candidate(tar)
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused bundle"), r.err)
        self.assertEqual(self.alert_name("staging"), "bundle")
        self.assertIn("%s" % x, self.state("staging", "quarantine"))
        self.assertEqual(self.releases(), [], "a refused bundle leaves nothing under releases/ (not even .incoming-*)")
        self.assertEqual([a for a in r.world.docker_log if a[1] in ("compose", "run", "start")], [])
        self.assertTrue(any(a[1] == "rm" for a in r.world.docker_log), "the created container is removed")
        return r


    def setUp_fresh(self):
        self.tearDown_world()

    def tearDown_world(self):
        # a second candidate in the same test: clear what the first one wrote
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        shutil.rmtree(str(self.host.p("/opt/polycarpic/releases")), ignore_errors=True)
        self.seed("staging", self.current_digest, "-", self.world.commit_a)
        self.world.registry.clear(), self.world.attested.clear(), self.world.runs.clear(), self.world.artifacts.clear()
        self.world.docker_log.clear()


class Bundle(BundleBase):
    # ---- T6: each unsafe member is refused ----
    def test_t6_a_symlink_member(self):
        self.refused_bundle(make_tar(good_files(), [member("infra/compose/x.yml", tarfile.SYMTYPE, link="/etc/shadow")]))

    def test_t6_a_member_that_is_a_symlink_replacing_a_manifest_file(self):
        f = good_files()
        del f["infra/compose/prod.yml"]
        self.refused_bundle(make_tar(f, [member("infra/compose/prod.yml", tarfile.SYMTYPE, link="staging.yml")]))

    def test_t6_a_hardlink_member(self):
        self.refused_bundle(make_tar(good_files(), [member("infra/compose/h.yml", tarfile.LNKTYPE, link="infra/compose/prod.yml")]))

    def test_t6_a_device_member(self):
        self.refused_bundle(make_tar(good_files(), [member("infra/compose/dev", tarfile.CHRTYPE)]))

    def test_t6_a_fifo_member(self):
        self.refused_bundle(make_tar(good_files(), [member("infra/compose/fifo", tarfile.FIFOTYPE)]))

    def test_t6_a_setuid_file(self):
        f = good_files()
        del f["infra/backup/backup.sh"]
        self.refused_bundle(make_tar(f, [member("infra/backup/backup.sh", mode=0o4755, data=b"#!/bin/sh\n")]))

    def test_t6_a_setgid_file(self):
        f = good_files()
        del f["infra/backup/upload.sh"]
        self.refused_bundle(make_tar(f, [member("infra/backup/upload.sh", mode=0o2755, data=b"#!/bin/sh\n")]))

    def test_t6_a_dotdot_path(self):
        self.refused_bundle(make_tar(good_files(), [member("infra/../etc/evil", data=b"x")]))

    def test_t6_an_absolute_path(self):
        self.refused_bundle(make_tar(good_files(), [member("/etc/evil", data=b"x")]))

    def test_t6_an_off_manifest_member_such_as_an_ops_script(self):
        self.refused_bundle(make_tar(good_files(), [member("infra/ops/polycarpic-ops", mode=0o755, data=b"#!/bin/sh\ntouch /canary\n")]))

    def test_t6_a_sparse_member(self):
        self.refused_bundle(make_tar(good_files(), [member("infra/compose/sparse", tarfile.GNUTYPE_SPARSE)]))

    def test_t6_a_pax_global_header_member(self):
        self.refused_bundle(make_tar(good_files(), [member("infra/pax", tarfile.XGLTYPE, data=b"")]))

    def test_t6_an_odd_member_in_a_manifest_directory_slot_is_refused_by_its_type_alone(self):
        # named like an allowed directory, so neither the manifest nor the missing-file check can refuse it: only the member-type check does
        for label, typ, link in (("symlink", tarfile.SYMTYPE, "/etc"), ("hardlink", tarfile.LNKTYPE, "infra/compose/prod.yml"), ("char device", tarfile.CHRTYPE, ""),
                                 ("block device", tarfile.BLKTYPE, ""), ("fifo", tarfile.FIFOTYPE, ""), ("sparse", tarfile.GNUTYPE_SPARSE, ""), ("pax global header", tarfile.XGLTYPE, "")):
            self.tearDown_world()
            self.refused_bundle(make_tar(good_files(), [member("infra/caddy", typ, link=link)]))

    def test_t6_a_missing_manifest_file(self):
        f = good_files()
        del f["infra/compose/edge.yml"]
        self.refused_bundle(make_tar(f))

    def test_t6_garbage_instead_of_a_tar(self):
        self.refused_bundle(b"this is not a tar" * 100)

    def test_t6_a_truncated_tar(self):
        self.refused_bundle((lambda b: b[:len(b) // 3])(make_tar(good_files())))

    def test_t6_a_member_declaring_an_absurd_size_is_refused_not_read(self):
        f = good_files()
        del f["infra/caddy/Caddyfile"]
        ti = tarfile.TarInfo("infra/caddy/Caddyfile")
        ti.size, ti.mode = 1 << 40, 0o644
        raw = make_tar(f).rstrip(b"\0") + ti.tobuf(tarfile.GNU_FORMAT) + b"x" * 512 + b"\0" * 1024
        self.refused_bundle(raw)

    def test_t6_a_bundle_over_64_mib_is_refused(self):
        # a tar whose members are all fine, followed by padding: only the whole-stream cap can refuse it
        self.refused_bundle(make_tar(good_files()) + b"\0" * CAP)

    def test_t6_a_single_file_over_the_cap_is_refused(self):
        f = good_files()
        f["infra/postgres/archive-wal.sh"] = b"#" * (CAP + 1)
        self.refused_bundle(make_tar(f))

    # ---- images.env is data too (R4) ----
    def test_images_env_with_an_extra_key_or_wrong_repository_or_tag_form(self):
        s = sibling_digests()
        for bad in (images_env_text(s) + "POLY_APP_IMAGE=ghcr.io/richmosko/polycarpic@%s\n" % digest("y"),
                    images_env_text(s).replace("polycarpic-caddy@", "polycarpic-tools@", 1),
                    images_env_text(s).replace("@sha256:", ":latest@sha256:", 1),
                    images_env_text(s).replace("ghcr.io/richmosko", "ghcr.io/anyone", 1),
                    "".join(images_env_text(s).splitlines(True)[:2])):
            self.setUp_fresh()
            self.refused_bundle(make_tar(good_files(bad)))

    # ---- positive: a good bundle is extracted, 0755/0644, no links, under releases/sha256-<hex>/ ----
    def test_a_good_bundle_is_extracted_to_releases_and_not_refused_as_bundle(self):
        x = self.candidate(make_tar(good_files()))
        r = self.deploy("staging")
        self.assertNotEqual(self.alert_name("staging"), "bundle", r.err)
        rel = self.host.p("/opt/polycarpic/releases/sha256-" + x.split(":")[1])
        self.assertTrue((rel / "infra/compose/staging.yml").is_file())
        self.assertEqual(oct((rel / "infra/backup/backup.sh").stat().st_mode & 0o7777), "0o755")
        self.assertEqual(oct((rel / "infra/compose/staging.yml").stat().st_mode & 0o7777), "0o644")
        for base, dirs, names in os.walk(str(rel)):
            for n in dirs + names:
                self.assertFalse(os.path.islink(os.path.join(base, n)))
        self.assertTrue((rel / "images.env").read_text().endswith("POLY_APP_IMAGE=%s@%s\n" % (REGISTRY, x)))
        # the extraction used create/cp/rm and never started anything with the digest before the guard
        subs = [a[1] for a in r.world.docker_log]
        self.assertNotIn("start", subs)
        self.assertEqual([a for a in r.world.docker_log if a[1] == "create"][0][:3], ["docker", "create", "--name"])


class Siblings(BundleBase):
    """T5 (S1, R3 V5): every sibling image passes V1 with the same C and the same flags, then V2 and V3."""

    def verifies(self, r):
        return [c["argv"] for c in r.runner.calls if c["argv"][:3] == ["gh", "attestation", "verify"]]

    def test_t5_a_sibling_failing_v1_stops_the_deploy_and_is_not_quarantined(self):
        for name in ("postgres", "tools", "caddy"):
            self.tearDown_world()
            x = self.candidate(make_tar(good_files()))
            self.world.attested.discard((sibling_digests()[name], self.world.commit_b))
            r = self.deploy("staging")
            self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused sibling-" + name), name)
            self.assertEqual((self.state("staging", "quarantine") or "").strip(), "", "V1 of a sibling is not a Q row")
            self.assertEqual([a for a in r.world.docker_log if a[1] in ("compose", "run")], [])

    def test_t5_a_sibling_attested_at_another_commit_is_refused(self):
        self.candidate(make_tar(good_files()))
        d = sibling_digests()["tools"]
        self.world.attested.discard((d, self.world.commit_b))
        self.world.attested.add((d, self.world.commit_a))
        r = self.deploy("staging")
        self.assertEqual(r.err.splitlines()[-1], "deploy: refused sibling-tools")

    def test_t5_a_sibling_with_the_wrong_label_is_refused_and_quarantined(self):
        x = self.candidate(make_tar(good_files()))
        self.world.image("polycarpic-caddy", sibling_digests()["caddy"], self.world.commit_a)
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused sibling-caddy"))
        self.assertIn(x, self.state("staging", "quarantine"))

    def test_t5_each_sibling_is_verified_with_the_same_flags_and_c(self):
        x = self.candidate(make_tar(good_files()))
        r = self.deploy("staging")
        v = self.verifies(r)
        self.assertEqual(len(v), 4)
        refs = sorted(a[3] for a in v)
        want = sorted(["oci://ghcr.io/richmosko/polycarpic@" + x] + ["oci://ghcr.io/richmosko/polycarpic-%s@%s" % (n, d) for n, d in sibling_digests().items()])
        self.assertEqual(refs, want)
        flagsets = set(tuple(sorted(a[4:])) for a in v)
        self.assertEqual(len(flagsets), 1, "the same six flags and the same C for every image")


class RealRunBytes(unittest.TestCase):
    """ctx.run_bytes in production: reads at most 64 MiB + 1 of a child's stdout, then kills the child (red on a mutant that reads it all first)."""

    def test_an_endless_child_is_cut_off_at_the_cap_and_killed(self):
        sys.path.insert(0, str(OPS))
        try:
            from lib import ctx as ctxmod
        finally:
            sys.path.remove(str(OPS))
        pidfile = Path(os.environ.get("TMPDIR", "/tmp")) / ("qa100-pid-%d" % os.getpid())
        code = ("import os,sys\nopen(%r,'w').write(str(os.getpid()))\nb=b'x'*65536\n"
                "while True:\n    sys.stdout.buffer.write(b); sys.stdout.buffer.flush()\n" % str(pidfile))
        t0 = time.time()
        rc, data, err = ctxmod.Ctx(root="/").run_bytes([sys.executable, "-I", "-c", code], timeout=60)
        took = time.time() - t0
        self.assertEqual(len(data), CAP + 1)
        self.assertLess(took, 30)
        pid = int(pidfile.read_text())
        pidfile.unlink()
        time.sleep(0.2)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        self.assertNotEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
