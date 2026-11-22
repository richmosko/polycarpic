#!/usr/bin/env python3
"""POLY-97 R8: set up and verify the Backblaze B2 backup bucket's keys, through the API.

  b2-setup.py [--bucket <name>]     verify the bucket, make the two keys, read everything back
  b2-setup.py --probe [--bucket <name>]   (once, to measure whether writeFiles alone is enough for rclone's upload)

1. You generate a new master key in Backblaze (App Keys -> Generate New Master Application Key) and type its two parts at
   hidden prompts. Nothing is written to disk, put in argv or the environment, or printed.
2. The bucket is read back through the API: private, Object Lock on in compliance mode, 35 days, lifecycle hide 36 /
   delete 1. Encryption is reported, not asserted.
3. Two keys are made, each restricted to the bucket: polycarpic-put-only (the box key: the capability set in
   b2-capabilities.json) and polycarpic-read (read and retention-read only). Each new secret is printed once, for your
   secret store. A key of the same name is shown and replaced only after a typed yes; two keys never share a name.
4. Every key is read back and its capability set and bucket asserted exactly. Any other key that holds this bucket fails.
5. You generate the master key again; the old one must then be refused (401). The master key is never to be stored.
Stdlib only, Python 3.9 compatible.
"""
import base64
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

AUTH_URL = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account"
PUT_NAME = "polycarpic-put-only"
READ_NAME = "polycarpic-read"
PROBE_NAME = "polycarpic-probe-temp"
READ_CAPS = ["listBuckets", "listFiles", "readFiles", "readBucketRetentions", "readFileRetentions", "readFileLegalHolds", "readBucketEncryption"]
CAPS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "b2-capabilities.json")


def real_transport(method, url, headers, body):
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"User-Agent": "polycarpic-ops/1.0"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read().decode("utf8", "replace"))
        except ValueError:
            return err.code, {}


def real_runner(argv, env=None, stdin=None):
    """Runs a command and returns (returncode, its output text). Raises FileNotFoundError when the program is missing."""
    done = subprocess.run(argv, env=env, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return done.returncode, done.stdout.decode("utf8", "replace")


class ApiError(Exception):
    pass


def main(argv, *, transport=None, getpass=None, input=None, stdout=sys.stdout, stderr=sys.stderr, runner=None, env=None, home=None):
    import builtins
    import getpass as _gp
    getpass = getpass or _gp.getpass
    input = input or builtins.input
    transport = transport or real_transport
    runner = runner or real_runner
    env = os.environ if env is None else env

    with open(CAPS_FILE, "r") as fh:
        pins = json.load(fh)
    box_caps = sorted(pins["capabilities"])
    bucket_name = pins.get("bucketName")
    probe = False
    args = list(argv)
    while args:
        a = args.pop(0)
        if a == "--probe":
            probe = True
        elif a == "--bucket" and args:
            bucket_name = args.pop(0)
        else:
            stderr.write("usage: b2-setup.py [--probe] [--bucket <name>]\n")
            return 2

    def out(line=""):
        stdout.write(line + "\n")

    def call(method, url, headers, body=None):
        status, data = transport(method, url, headers, body)
        if status != 200:
            raise ApiError("Backblaze refused the request (HTTP %s %s): %s" % (status, data.get("code", ""), data.get("message", "no message")))
        return data

    failed = 0

    def result(ok, text):
        nonlocal failed
        if not ok:
            failed += 1
        out("%s %s" % ("PASS" if ok else "FAIL", text))

    try:
        out("In Backblaze, App Keys -> Generate New Master Application Key.")
        key_id = getpass("New master key ID (hidden): ").strip()
        app_key = getpass("New master application key (hidden): ").strip()
        basic = base64.b64encode(("%s:%s" % (key_id, app_key)).encode()).decode()
        del app_key, key_id
        auth = call("GET", AUTH_URL, {"Authorization": "Basic " + basic})
        api = auth["apiUrl"] + "/b2api/v2/"
        hdr = {"Authorization": auth["authorizationToken"]}
        account = auth["accountId"]
        s3_url = auth.get("s3ApiUrl", "")
        del auth

        buckets = call("POST", api + "b2_list_buckets", hdr, {"accountId": account, "bucketName": bucket_name}).get("buckets", [])
        buckets = [b for b in buckets if b.get("bucketName") == bucket_name]
        if not buckets:
            raise ApiError("no bucket named %s on this account" % bucket_name)
        bucket = buckets[0]
        bucket_id = bucket["bucketId"]

        if probe:
            code = run_probe(call, api, hdr, account, bucket_id, bucket_name, s3_url, runner, env, out)
            ok = master_regenerated(transport, basic, input, out, result)
            return 1 if (failed or not ok) else code

        out()
        out("Bucket %s:" % bucket_name)
        result(bucket.get("bucketType") == "allPrivate", "bucketType is %s (want allPrivate)" % bucket.get("bucketType"))
        lock = (bucket.get("fileLockConfiguration") or {}).get("value") or {}
        retention = lock.get("defaultRetention") or {}
        period = retention.get("period") or {}
        result(bool(lock.get("isFileLockEnabled")), "file lock is %s on the bucket" % ("enabled" if lock.get("isFileLockEnabled") else "NOT enabled"))
        result(retention.get("mode") == "compliance", "file lock default mode is %s (want compliance)" % retention.get("mode"))
        result(period.get("duration") == 35 and period.get("unit") == "days",
               "default retention is %s %s (want 35 days)" % (period.get("duration"), period.get("unit")))
        rules = bucket.get("lifecycleRules") or []
        rule = next((r for r in rules if r.get("fileNamePrefix", "") == ""), None)
        hide = rule.get("daysFromUploadingToHiding") if rule else None
        delete = rule.get("daysFromHidingToDeleting") if rule else None
        result(hide == 36, "lifecycle hides after %s days (want 36)" % hide)
        result(delete == 1, "lifecycle deletes %s days after hiding (want 1)" % delete)
        enc = ((bucket.get("defaultServerSideEncryption") or {}).get("value") or {}).get("mode")
        out("INFO encryption: %s (reported, not asserted)" % (enc or "none"))

        # Plan: the two keys, then a typed yes.
        wanted = [(PUT_NAME, box_caps), (READ_NAME, sorted(READ_CAPS))]
        keys = list_keys(call, api, hdr, account)
        out()
        out("Plan: create two keys, each restricted to bucket %s:" % bucket_name)
        for name, caps in wanted:
            out("  %s: %s" % (name, ", ".join(caps)))
            for k in keys:
                if k.get("keyName") == name:
                    out("    a key of this name exists (%s) and would be deleted and recreated" % k["applicationKeyId"])
        if input("Apply this plan? Type yes to apply: ").strip() == "yes":
            for name, caps in wanted:
                existing = [k for k in keys if k.get("keyName") == name]
                skip = False
                for k in existing:
                    out("Existing key %s (%s) holds: %s" % (name, k["applicationKeyId"], ", ".join(sorted(k.get("capabilities", [])))))
                    if input("Delete it so it can be recreated? Type yes to delete: ").strip() == "yes":
                        call("POST", api + "b2_delete_key", hdr, {"applicationKeyId": k["applicationKeyId"]})
                        out("  deleted.")
                    else:
                        out("  kept; no second key of this name will be made.")
                        skip = True
                if skip:
                    continue
                new = call("POST", api + "b2_create_key", hdr, {"accountId": account, "capabilities": caps, "keyName": name, "bucketId": bucket_id})
                out()
                out("=== NEW KEY %s: shown once; copy it into your secret store now, never into chat ===" % name)
                out("key id:          %s" % new["applicationKeyId"])
                out("application key: %s" % new["applicationKey"])
                out("capabilities:    %s" % ", ".join(sorted(new["capabilities"])))
                del new
        else:
            out("Nothing changed.")

        # Read back every key.
        out()
        out("Keys read back:")
        keys = list_keys(call, api, hdr, account)
        pinned = dict((n, sorted(c)) for n, c in wanted)
        for name, caps in wanted:
            found = [k for k in keys if k.get("keyName") == name]
            if not found:
                result(False, "%s: no such key (create it with this tool)" % name)
                continue
            for k in found:
                have = sorted(k.get("capabilities", []))
                problems = []
                if have != caps:
                    problems.append("capabilities differ (extra: %s; missing: %s)" % (", ".join(sorted(set(have) - set(caps))) or "none", ", ".join(sorted(set(caps) - set(have))) or "none"))
                if k.get("bucketId") != bucket_id:
                    problems.append("not restricted to bucket %s" % bucket_name)
                if k.get("namePrefix"):
                    problems.append("has a name prefix")
                if problems:
                    result(False, "%s: %s" % (name, "; ".join(problems)))
                else:
                    result(True, "%s: exactly %s; bucket-restricted" % (name, ", ".join(caps)))
        for k in keys:
            if k.get("keyName") in pinned:
                continue
            if k.get("bucketId") == bucket_id:
                result(False, "%s holds bucket %s: delete it in Backblaze (App Keys)" % (k.get("keyName"), bucket_name))
            elif not k.get("bucketId"):
                writes = sorted(set(k.get("capabilities", [])) - set(READ_CAPS) - {"listAllBucketNames"})
                if writes:
                    result(False, "%s is not restricted to a bucket and can write to %s (%s): restrict it to another bucket or delete it" % (k.get("keyName"), bucket_name, ", ".join(writes)))
                else:
                    out("WARN %s is not restricted to a bucket, so it can read %s (ciphertext only): check that you still need it" % (k.get("keyName"), bucket_name))

        # The master key must now be regenerated, and the old one refused.
        out()
        master_regenerated(transport, basic, input, out, result)
    except ApiError as err:
        stderr.write("error: %s\n" % err)
        return 1
    out()
    out("B2 SETUP PASSED" if not failed else "%d B2 CHECKS FAILED" % failed)
    return 1 if failed else 0


def master_regenerated(transport, basic, input, out, result):
    """The old master key must be refused once a new one is generated. Returns True when it is."""
    out("Now generate a new master key again (App Keys -> Generate New Master Application Key).")
    input("Type done when the new master key is generated: ")
    status, data = transport("GET", AUTH_URL, {"Authorization": "Basic " + basic}, None)
    ok = status == 401
    if ok:
        result(True, "the old master key is rejected (401): it was regenerated")
    else:
        result(False, "the old master key is still live (HTTP %s): generate a new master key now" % status)
    out("The master key is never to be stored or saved: it can be regenerated from the console behind two-step sign-in.")
    return ok


def list_keys(call, api, hdr, account):
    keys, start = [], None
    while True:
        body = {"accountId": account, "maxKeyCount": 100}
        if start:
            body["startApplicationKeyId"] = start
        data = call("POST", api + "b2_list_keys", hdr, body)
        keys.extend(data.get("keys", []))
        start = data.get("nextApplicationKeyId")
        if not start:
            return keys


def run_probe(call, api, hdr, account, bucket_id, bucket_name, s3_url, runner, env, out):
    """E9: one upload through a temporary writeFiles-only key, to learn whether the box key needs listBuckets."""
    new = call("POST", api + "b2_create_key", hdr, {"accountId": account, "capabilities": ["writeFiles"], "keyName": PROBE_NAME, "bucketId": bucket_id})
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = "probe:%s/probe/%s" % (bucket_name, stamp)
    child = dict(env)
    # The uploader uses rclone's S3 backend, so the probe measures that path, set from the environment the same way.
    child["RCLONE_CONFIG_PROBE_TYPE"] = "s3"
    child["RCLONE_CONFIG_PROBE_PROVIDER"] = "Other"
    child["RCLONE_CONFIG_PROBE_ENDPOINT"] = s3_url
    child["RCLONE_CONFIG_PROBE_ACCESS_KEY_ID"] = new["applicationKeyId"]
    child["RCLONE_CONFIG_PROBE_SECRET_ACCESS_KEY"] = new["applicationKey"]
    child["RCLONE_CONFIG_PROBE_NO_CHECK_BUCKET"] = "true"
    code, text, error = None, "", None
    try:
        code, text = runner(["rclone", "rcat", "--s3-no-head", target], env=child, stdin=b"x")
    except OSError as err:  # rclone missing or not runnable
        error = err.__class__.__name__
    finally:
        call("POST", api + "b2_delete_key", hdr, {"applicationKeyId": new["applicationKeyId"]})
        del child, new
    out()
    denied = bool(re.search(r"access ?denied|\b40[13]\b|not authori[sz]ed|forbidden|unauthori[sz]ed", text or "", re.I))
    if error is None and code == 0:
        out("PROBE: the writeFiles-only upload was accepted (%s): writeFiles alone is enough. The box-key constant can be {writeFiles}: set b2-capabilities.json and recreate the put-only key." % target)
        out("The probe object stays locked for 35 days; that costs next to nothing.")
        result = 0
    elif error is None and code != 0 and denied:
        out("PROBE: the writeFiles-only upload was refused (access denied): listBuckets is needed. Keep listBuckets in b2-capabilities.json.")
        result = 0
    else:
        why = "rclone could not be run (%s)" % error if error else "rclone exited %s without a permission error" % code
        out("PROBE: INCONCLUSIVE: %s. This says nothing about the capability set; fix the cause and run --probe again." % why)
        result = 1
    out("The temporary key was deleted.")
    return result


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
