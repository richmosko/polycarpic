"""The pull-based deploy (POLY-100): finds the candidate, verifies all of it, and only then runs anything of it.

Exit codes: 0 done, nothing to do, busy or a transient outage (the timer); 1 refused or failed; 4 precondition.
"""
import fcntl
import os
import re
import signal
import tempfile
import threading

from lib import compose, compose_guard, dirs, guardhelp, release as rel, sauth, spool, stack, tokenexp
from lib.release import Refusal

LOCK = "/run/polycarpic/deploy.lock"
BACKUP_TIMEOUT = 65 * 60
MIGRATE_TIMEOUT = 30 * 60
CHECK_CONFIG_TIMEOUT = 120
DATA = "/srv/polycarpic"
EDGE_ENV = "/etc/polycarpic/edge.env"
STALE = 3600


def take_lock(ctx, wait=0):
    run_dir = ctx.p("/run/polycarpic")
    os.makedirs(run_dir, mode=0o755, exist_ok=True)
    fd = os.open(ctx.p(LOCK), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    start = ctx.epoch()
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except OSError:
            if ctx.epoch() - start >= wait:
                os.close(fd)
                return None
            ctx.sleep(30)


def require_data_mount(ctx):
    """F13: the data directory must be a mount point; an unmounted volume would start a fresh cluster on the unencrypted root disk."""
    if not ctx.ismount(DATA):
        raise Refusal("data-mount", code=4)


def locked(project, ctx, first, wait=0, existing_data=False):
    fd = take_lock(ctx, wait)
    if fd is None:
        if first:
            ctx.err("deploy: the deploy lock was not got in %d minutes" % (wait // 60))
            return 4
        _note(ctx, project, "busy")
        return 0
    try:
        try:
            dirs.ensure_shared(ctx, project)  # G1: every shared directory exactly 0755, or `render-path` and nothing repaired through a link
        except Refusal as err:
            return refuse(project, ctx, err)
        rel.clear_incoming(ctx)  # leftovers of an interrupted run, removed under the lock (F3)
        return _deploy(project, ctx, first, existing_data)
    finally:
        os.close(fd)


class _Skip(Exception):
    pass


class _Stop(Exception):
    """The run ends here with this exit code; the alert and log are already written."""
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _unlink(ctx, project, name):
    try:
        os.unlink(os.path.join(rel.sdir(ctx, project), name))
    except FileNotFoundError:
        pass


# ---- F12: a silent freeze is an alert after an hour
def mark_transient(ctx, project):
    """Never raises (G6): a bad or unwritable file is alerted `state`, and the run still ends as a transient."""
    try:
        since = rel.read(ctx, project, "transient-since")
        now = ctx.epoch()
        if since is None:
            rel.put(ctx, project, "transient-since", rel.now_utc(ctx) + "\n")
            return
        t0 = rel.ts.parse(since.strip())
        if t0 is None:
            raise Refusal("state")
        if now - t0 > STALE:
            rel.alert(ctx, project, "transient-stale")
    except Exception:
        try:
            rel.alert(ctx, project, "state")
        except Exception:
            pass


def clear_transient(ctx, project):
    """Never raises (R4.2): a file that cannot be removed is one stderr line, and the run goes on."""
    try:
        _unlink(ctx, project, "transient-since")
    except Exception:
        ctx.err("deploy: could not clear transient-since")


# ---- F2, R1: an interrupted run (power loss, systemd's kill, Ctrl-C) is found by `in-progress`, which is kept by default
STOP_SERVICES = ("web", "auth", "worker")
STOP_CLIENT = 60
MARK_HELP = "in-progress is malformed; after checking: sudo rm /var/lib/polycarpic/state/deploy/%s/in-progress"


def new_run():
    return {"up": False, "cur": None, "loaded": False, "owns": False, "probe": None, "work": None, "stuck": False, "stuck_digest": None,
            "committed": False, "healthy": False}


def _mark(ctx, project):
    """-> (present, digest or None). Only a missing file is absent; an unreadable, empty or malformed one is present with no digest (R1.3a)."""
    try:
        path = os.path.join(rel.sdir(ctx, project), "in-progress")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False, None
    except OSError:
        return True, None
    try:
        text = os.read(fd, 4096).decode("utf-8", "replace").strip()
    except OSError:
        return True, None
    finally:
        os.close(fd)
    return True, (text if rel.DIGEST.fullmatch(text) else None)


def _mark_present(ctx, project):
    return _mark(ctx, project)[0]


def _listing(ctx, cproject, svc):
    """The ids of running or restarting containers of one service of one project, by label: plain Docker, since Compose or the render may be the fault."""
    code, out, _ = ctx.run(["docker", "ps", "-q", "--no-trunc", "--filter", "label=com.docker.compose.project=" + cproject,
                            "--filter", "label=com.docker.compose.service=" + svc], timeout=30)
    if code != 0:
        raise OSError("docker ps")
    return [l.strip() for l in out.splitlines() if l.strip()]


def _keep_ref(project, ctx, cur):
    """The image reference of `current`'s own service containers, or None when it cannot be read (then everything is stopped)."""
    if not cur:
        return None
    try:
        kinds = stack.kinds(stack.refs(rel.release_dir(ctx, cur["digest"])))
        return kinds["caddy"] if project == "edge" else kinds["app"]
    except Exception:
        return None


def stand_down(project, ctx, keep_ref=None):
    """R1.2: stop (never `down`, `rm` or remove) this project's `web`, `auth`, `worker` (edge: `caddy`) except containers of `keep_ref`, which is `current`'s
    own reference; Postgres stays. Read back by a second listing, never by the exit code. -> True when nothing but a kept container is shown running."""
    cproject = "polycarpic-" + project
    services = ("caddy",) if project == "edge" else STOP_SERVICES
    ok = True
    for svc in services:
        kept = set()
        try:
            for cid in _listing(ctx, cproject, svc):
                try:
                    if keep_ref is not None and compose.image_ref(compose.inspect(ctx, cid, timeout=30)) == keep_ref:
                        kept.add(cid)
                        continue
                except (TimeoutError, OSError):
                    pass  # an image that cannot be read is stopped
                try:
                    ctx.run(["docker", "stop", "--time", "30", cid], timeout=STOP_CLIENT)
                except (TimeoutError, OSError):
                    pass
            ok = ok and all(cid in kept for cid in _listing(ctx, cproject, svc))
        except (TimeoutError, OSError):
            ok = False
    if not ok:
        try:
            rel.alert(ctx, project, "not-stopped")
        except Exception:
            pass
        ctx.err("deploy: not-stopped: a container of the candidate could not be shown stopped")
    return ok


def _held(ctx, project, digest):
    """R1.3b: held by `quarantined()`'s own rule, lift included. An unreadable quarantine file bans nothing here."""
    try:
        return digest in rel.quarantined(ctx, project)
    except Exception:
        return False


def restore_checked(ctx, project, cur, do):
    """An automatic restore of `current`: True, False, or the alert name `current-quarantined` when `current` is held (nothing is upped)."""
    if _held(ctx, project, cur["digest"]):
        return "current-quarantined"
    try:
        return bool(do())
    except Exception:
        return False


def _restore_cur(project, ctx, cur, keep=False, probe=None):
    if project == "edge":
        from lib import edge
        return restore_checked(ctx, project, cur, lambda: edge.restore(ctx, cur, keep=keep))
    return restore_checked(ctx, project, cur, lambda: restore(project, ctx, cur, project == "prod", probe, keep=keep))


def _stuck_records(project, ctx, name, digest, stopped):
    final = "not-stopped" if not stopped else name
    try:
        rel.alert(ctx, project, final)
    except Exception:
        pass
    _note(ctx, project, "rollback-unhealthy", digest or "-")
    ctx.err("deploy: " + final)


def _caddy_back(project, ctx):
    """A prod run with no `current` that ups Caddy puts it back on edge's `current` (S23)."""
    if project != "prod":
        return
    from lib import edge
    try:
        ptr = rel.load_pointer(ctx, "edge", "current")
        if ptr:
            edge.restore(ctx, ptr, wait_healthy=False)
    except Exception:
        pass


def _interrupted_records(project, ctx, digest):
    """R1.3g: the alert and the log, each in its own `try`; then the record (the second time for a digest it is quarantined). Not on disk: stopped."""
    try:
        rel.alert(ctx, project, "interrupted")
    except Exception:
        pass
    _note(ctx, project, "refused", "interrupted", digest or "-")
    if digest is None:
        return
    try:
        prev = rel.read(ctx, project, "interrupted")
        if prev is not None and prev.strip() == digest:
            rel.quarantine(ctx, project, digest, "interrupted")
        else:
            rel.put(ctx, project, "interrupted", digest + "\n")
    except Exception:
        ctx.err("deploy: the record of the interruption could not be written")
        raise _Stop(1)


def _clear_mark(ctx, project):
    try:
        _unlink(ctx, project, "in-progress")
    except OSError:
        ctx.err("deploy: the interrupted-run mark could not be removed")
        raise _Stop(1)


def recover(project, ctx, cur, run):
    """R1.3: with the mark present, `current` is put back FIRST, before any check, record, token or network call. -> None (no mark), "recovered", or
    "stuck" (the restore failed: the candidate's services are stopped, RED, the mark kept, tried again next run)."""
    present, digest = _mark(ctx, project)
    if not present:
        return None
    ctx.err("deploy: recovering an interrupted run")
    if not cur:
        stopped = stand_down(project, ctx, None)
        _caddy_back(project, ctx)
        if not stopped:
            raise _Stop(1)
        _interrupted_records(project, ctx, digest)
        _clear_mark(ctx, project)
        return "recovered"
    keep = not compose_guard.version_ok(ctx)
    if keep:
        ctx.err("warning: compose is not the pinned version; a recovery uses the saved render of the release")
    res = _restore_cur(project, ctx, cur, keep=keep)
    if res is not True:
        stopped = stand_down(project, ctx, _keep_ref(project, ctx, cur))
        _stuck_records(project, ctx, res if isinstance(res, str) else "rollback-unhealthy", digest, stopped)
        run["stuck"], run["stuck_digest"] = True, digest
        return "stuck"
    if digest is None:
        err = Refusal("state")
        err.help_lines = (MARK_HELP % project,)
        raise err
    if digest == cur["digest"]:
        if not settle(project, ctx, rel.release_dir(ctx, digest), digest):
            raise _Stop(1)
        return "recovered"
    _interrupted_records(project, ctx, digest)
    _clear_mark(ctx, project)
    return "recovered"


def recovered_first(project, ctx, cur):
    """R1.9, for `rollback` by hand: with the mark present the interrupted run is recovered first. -> an exit code when that is all `rollback` did
    (a good recovery exits 1, nothing is rolled back), else None: go on to `previous`."""
    try:
        res = recover(project, ctx, cur, new_run())
    except _Stop as stop:
        return stop.code
    except Refusal as err:
        for line in err.help_lines or ():
            ctx.err(line)
        ctx.err("rollback: refused %s" % err.name)
        return err.code
    if res == "recovered" and cur:
        ctx.err("rollback: recovered; nothing rolled back")
        return 1
    return None


class _Signals(object):
    """SIGHUP and SIGTERM take Ctrl-C's path for the length of the run (main thread only); the old handlers are put back on every path."""
    def __enter__(self):
        self.old = {}
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGHUP, signal.SIGTERM):
                try:
                    self.old[sig] = signal.signal(sig, self._raise)
                except (ValueError, OSError):
                    pass
        return self

    @staticmethod
    def _raise(sig, frame):
        raise SystemExit(128 + sig)

    def __exit__(self, *exc):
        for sig, handler in self.old.items():
            try:
                signal.signal(sig, handler)
            except (ValueError, OSError):
                pass
        return False


def on_interrupt(project, ctx, run):
    """R1.8: a non-`Exception` with the mark present. With a loaded pointer showing no `current` the candidate's services are stopped; the alert and the
    stderr line are best effort; none can stop the next, and a second signal in here leaves the mark in place."""
    try:
        if not _mark_present(ctx, project):
            return
        if run.get("loaded") and not run.get("cur"):
            stand_down(project, ctx, None)
        try:
            rel.alert(ctx, project, "interrupted")
        except Exception:
            pass
        try:
            ctx.err("deploy: interrupted; run the same command again")
        except Exception:
            pass
    except BaseException:
        pass


def stuck_end(project, ctx):
    """A run that started stuck and did not end healthy: `rollback-unhealthy` is its last alert and its last stderr line, so nothing hides it."""
    try:
        rel.alert(ctx, project, "rollback-unhealthy")
    except Exception:
        pass
    ctx.err("deploy: rollback-unhealthy")
    return 1


def settle(project, ctx, rdir, digest):
    """R2.2: finish what a promotion leaves: link, prod's images.env, first-attempt, the interruption's record, prune. Idempotent, each step in its own `try`.
    All good: the alert, then the mark go, `healthy` is logged, True. Else the alert `records`, stderr, the mark kept, False."""
    ok = True
    steps = [lambda: link_current(ctx, project, rdir)]
    if project == "prod":
        steps.append(lambda: rel.write(ctx, ctx.p("/opt/polycarpic/images.env"), open(os.path.join(rdir, "images.env"), encoding="utf-8").read()))
    if project != "edge":
        steps.append(lambda: _unlink(ctx, project, "first-attempt"))

    def inter():
        text = rel.read(ctx, project, "interrupted")
        if text is not None and text.strip() == digest:  # that digest is healthy now (S33)
            _unlink(ctx, project, "interrupted")
    steps.append(inter)
    for step in steps:
        try:
            step()
        except Exception:
            ok = False
    try:
        _prune(ctx)  # its failure does not count
    except Exception:
        pass
    if ok:
        try:
            rel.clear_alert(ctx, project)
            _unlink(ctx, project, "in-progress")
        except Exception:
            ok = False
    if not ok:
        try:
            rel.alert(ctx, project, "records")
        except Exception:
            pass
        ctx.err("deploy: records: the release is healthy and current, but its records could not all be written; run the command again")
        return False
    _note(ctx, project, "healthy", digest)
    return True


def commit(project, ctx, cur, new, run):
    """R2.1: the one commit point of a healthy candidate: tree hash first; save `previous`; save `current`. If a save raises: `current` is re-read; naming the
    new digest it is committed, else `previous` is put back (best effort) and the error raised, so the unwind restores the old release. -> the pointer."""
    rdir = rel.release_dir(ctx, new["digest"])
    ptr = dict(digest=new["digest"], tag=new["tag"], commit=new["commit"], tree=stack.tree(rdir), at=rel.now_utc(ctx))
    old_prev = rel.load_pointer(ctx, project, "previous")
    try:
        if cur:
            rel.save_pointer(ctx, project, "previous", cur)
        rel.save_pointer(ctx, project, "current", ptr)
    except Exception:
        try:
            named = rel.load_pointer(ctx, project, "current")
        except Exception:
            named = None
        if named and named["digest"] == ptr["digest"]:
            run["committed"] = True
            run["healthy"] = True
            return ptr
        try:
            if old_prev:
                rel.save_pointer(ctx, project, "previous", old_prev)
            else:
                _unlink(ctx, project, "previous")
        except Exception:
            pass
        raise
    run["committed"] = True
    run["healthy"] = True
    return ptr


def _note(ctx, project, *fields):
    """A log line that can never end a run (G2, G6): a full disk is not a reason to leave a candidate half in."""
    try:
        rel.log(ctx, project, *fields)
    except Exception:
        try:
            ctx.err("deploy: could not write a log line")
        except Exception:
            pass


def _internal(project, ctx, err, digest, run):
    """One handler above `_deploy` (F2): before the first `up` a refusal `internal` (alert, no Q); after it the unwind (R8's automatic rollback);
    after the commit nothing unwinds (R2.3)."""
    ctx.err("deploy: internal error: %s" % err.__class__.__name__)
    if run["committed"]:
        return after_commit(project, ctx)
    if not run["up"]:
        try:
            rel.alert(ctx, project, "internal")
        except Exception:
            pass
        _note(ctx, project, "refused", "internal", digest)
        ctx.err("deploy: refused internal")
        return 1
    return _rollback_auto(project, ctx, digest, run["cur"], run["owns"], run["probe"], why="internal", run=run)


def after_commit(project, ctx):
    """R2.3: the release is healthy and `current`; a failure after that is not a reason to unwind. The records are finished by the next run."""
    try:
        rel.alert(ctx, project, "records")
    except Exception:
        pass
    ctx.err("deploy: records: the release is healthy and current; run the command again")
    return 1


def _deploy(project, ctx, first, existing_data):
    seen = {"digest": "-"}
    run = new_run()
    with _Signals():
        try:
            code = _handled(project, ctx, first, existing_data, seen, run)
        except BaseException as exc:
            if not isinstance(exc, Exception):
                on_interrupt(project, ctx, run)
            raise
        finally:
            if run["work"]:
                rel.remove_tree(run["work"])
    if run["stuck"] and not run["healthy"]:
        return stuck_end(project, ctx)
    return code


def _handled(project, ctx, first, existing_data, seen, run):
    try:
        try:
            return _deploy_checked(project, ctx, first, existing_data, seen, run)
        except (rel.Transient, Refusal, _Stop):
            raise
        except Exception as err:
            return _internal(project, ctx, err, seen["digest"], run)
    except rel.Transient as err:
        _note(ctx, project, "transient", str(err))
        mark_transient(ctx, project)
        if first:  # F7: a foreground first deploy says why it did nothing
            ctx.err("deploy: transient: %s" % err)
            return 1
        return 0
    except Refusal as err:
        if run["committed"]:
            return after_commit(project, ctx)
        if run["up"]:  # G2: a refusal after the first `up` is not a clean refusal: the old release comes back first
            return _rollback_auto(project, ctx, seen["digest"], run["cur"], run["owns"], run["probe"], reason=err.name if err.quarantine else "held-" + err.name, why=err.name, run=run)
        return refuse(project, ctx, err, seen["digest"])
    except _Stop as stop:
        return stop.code


def _deploy_checked(project, ctx, first, existing_data, seen, run):
    require_data_mount(ctx)
    cur = rel.load_pointer(ctx, project, "current")  # a damaged one is `state`: nothing safe to restore
    run["cur"], run["loaded"] = cur, True
    recover(project, ctx, cur, run)  # R1: before any check that can refuse, any record, the token or the network
    work = tempfile.mkdtemp(prefix="work-", dir=rel.sdir(ctx, project))
    run["work"] = work
    os.chmod(work, 0o700)
    compose_guard.check_compose_version(ctx)  # G10, before any network call
    tok = rel.token(ctx)
    tokenexp.refresh(ctx, tok, work)
    rel.load_pointer(ctx, project, "previous")  # a present but unparsable pointer stops the run with `state` (S17)
    since = rel.read(ctx, project, "transient-since")  # F12: a malformed mark stops the run with `state`
    if since is not None and rel.ts.parse(since.strip()) is None:
        raise Refusal("state")
    if cur:  # a leftover first-attempt file beside `current` has no effect and is removed (S19)
        _unlink(ctx, project, "first-attempt")
    if first and cur:
        raise Refusal("already-deployed", code=4)
    if not first and not cur:
        raise Refusal("not-first-deployed", code=4)
    fresh = _first_preconditions(project, ctx, existing_data) if first else False
    try:
        digest, commit, tag = _candidate(project, ctx, tok, work, cur, seen, run, first)
    except _Skip:
        clear_transient(ctx, project)
        return 0
    rel.log(ctx, project, "candidate", digest, commit)
    if project == "prod":
        check_edge_env(ctx)  # F10, before V1
        check_staging_auth(ctx)  # before V1: the file is Caddyfile text, and a prod run ups Caddy (S30)
    rdir, images, created = _verify(project, ctx, tok, work, digest, commit)
    clear_transient(ctx, project)  # past V5
    keep = False
    try:
        owner, judged = _gate(project, ctx, rdir, images, cur, commit, tag)
        rel.log(ctx, project, "verified", digest)
        keep = True
        return _roll_out(project, ctx, rdir, digest, tag, commit, cur, first, existing_data, owner, fresh, judged, run)
    finally:
        if not keep and created:
            rel.remove_created(ctx, rdir, digest)


def check_staging_auth(ctx):
    reason = sauth.check(ctx)
    if reason:
        ctx.err("deploy: staging-auth: %s; run polycarpic-ops staging-auth" % reason)
        raise Refusal("staging-auth")


def check_edge_env(ctx):
    """F10: edge.env unreadable or missing a key is the refusal `edge-env`, before V1, for prod and edge-deploy."""
    try:
        with open(ctx.p(EDGE_ENV), encoding="utf-8") as fh:
            text = fh.read(8192)
    except OSError:
        raise Refusal("edge-env")
    keys = set(l.split("=", 1)[0] for l in text.splitlines() if "=" in l)
    if not {"POLY_DOMAIN", "POLY_BIND_ADDR", "POLY_STAGING_ALLOW", "POLY_TLS"} <= keys:
        raise Refusal("edge-env")


def refuse(project, ctx, err, digest="-"):
    """G6: the alert first, then the log, then the quarantine, each in its own `try`, so a failed write cannot stop the next."""
    text = err.help_lines or ()
    for step in (lambda: rel.alert(ctx, project, err.name, text),
                 lambda: [rel.log(ctx, project, "refused", err.name, digest)] + [rel.log(ctx, project, "help", line) for line in text],
                 lambda: rel.quarantine(ctx, project, digest, err.name) if err.quarantine and digest != "-" else None):
        try:
            step()
        except Exception as fail:
            ctx.err("deploy: could not write a record: %s" % fail.__class__.__name__)
    for line in text:
        ctx.err(line)
    ctx.err("deploy: refused " + err.name)
    return err.code if err.code else 1


def _first_preconditions(project, ctx, existing_data):
    """A8: a non-empty data directory needs --existing-data or this project's own `first-attempt` file. -> True when the directory is empty (fresh)."""
    data = ctx.p("/srv/polycarpic/pg-" + project)
    empty = not (os.path.isdir(data) and os.listdir(data))
    if not empty and not existing_data and rel.read(ctx, project, "first-attempt") is None:
        raise Refusal("existing-data", code=4)
    return empty and not existing_data


def _candidate(project, ctx, tok, work, cur, seen, run, first=False):
    """R2: -> (digest, commit, tag). Raises _Skip when there is nothing new, or the candidate is quarantined."""
    if project == "staging":
        digest, commit, _ = rel.staging_candidate(ctx, tok, work)
        tag = "-"
    else:
        digest, tag = rel.prod_candidate(ctx, tok, work)
        commit = None
    seen["digest"] = digest
    if run["stuck"] and digest == run["stuck_digest"]:  # R1.4: the candidate that is stuck is not tried again; a different one may deploy
        raise _Skip()
    rel.put(ctx, project, "last-poll", rel.now_utc(ctx) + "\n")
    inter = rel.read(ctx, project, "interrupted")
    if inter is not None and inter.strip() != digest:  # another digest is tried: the interruption's mark goes (S33)
        _unlink(ctx, project, "interrupted")
    if cur and cur["digest"] == digest:
        raise _Skip()
    if digest in rel.quarantined(ctx, project):
        rel.log(ctx, project, "quarantined", digest)
        if first:  # a foreground first deploy says why it did nothing
            ctx.err("deploy: the candidate %s is quarantined; nothing was started" % digest)
        raise _Skip()
    if project == "prod":
        commit = rel.tag_commit(ctx, tag)
        if cur and rel.semver(tag) <= rel.semver(cur["tag"]):
            _not_newer(project, ctx, digest)
    elif cur and not rel.descends(ctx, cur["commit"], commit):
        _not_newer(project, ctx, digest)
    return digest, commit, tag


def _not_newer(project, ctx, digest):
    rel.log(ctx, project, "not-newer", digest)
    raise Refusal("not-newer")


def _verify(project, ctx, tok, work, digest, commit):
    """R3 V1-V5: the app image, then the bundle and each sibling, all in `.incoming-*`; then the directory is adopted (F3).
    Nothing of the digest is run. -> (release dir, the four image refs, whether this run created the directory)."""
    ref = rel.verify_image(ctx, tok, work, "polycarpic", digest, commit)
    incoming = rel.extract(ctx, ref, digest)
    try:
        text = open(os.path.join(incoming, "infra/release/images.env"), encoding="utf-8").read()
        siblings = rel.parse_images_env(text)
        for key in rel.IMAGE_KEYS:
            repo, dig = siblings[key]
            rel.verify_image(ctx, tok, work, "polycarpic-" + repo, dig, commit, sibling=repo)
        rel.write_images_env(ctx, incoming, ref, text)
        rdir, created = rel.adopt(ctx, incoming, digest)
    except BaseException:
        rel.remove_tree(incoming)
        raise
    return rdir, stack.kinds(stack.refs(rdir)), created


def _gate(project, ctx, rdir, images, cur, commit, tag):
    """V6 (the Postgres major is unchanged) and V7 (the installed guard on the rendered config). A refusal of the CANDIDATE by the guard
    carries the operator text (R10); a refusal of `current` or `previous` elsewhere does not. -> (owner, the render directories judged)."""
    try:
        return _gate_checks(project, ctx, rdir, images, cur, commit)
    except Refusal as err:
        err.help_lines = guardhelp.lines(ctx, err.name, commit, tag)
        raise


def _gate_checks(project, ctx, rdir, images, cur, commit):
    if project == "prod" and not cur:  # prod takes over from edge once (S23): C equals or descends from edge's commit, else `edge-older` (no Q)
        edge_cur = rel.load_pointer(ctx, "edge", "current")
        if edge_cur and edge_cur["commit"] != commit and not rel.descends(ctx, edge_cur["commit"], commit):
            raise Refusal("edge-older")
    if cur:
        old = rel.ts.read_text(os.path.join(rel.release_dir(ctx, cur["digest"]), "infra/postgres-major"))
        new = rel.ts.read_text(os.path.join(rdir, "infra/postgres-major"))
        if old is None or old.strip() != (new or "").strip():
            raise Refusal("postgres-major", True)
    owner = project == "prod"  # R9 strict: edge is prod's alone; a staging run never renders or ups it
    judged = {project: guard(project, ctx, rdir, images)}
    if owner:
        judged["edge"] = guard("edge", ctx, rdir, images)
    return owner, judged


def bind_addr(ctx):
    text = rel.ts.read_text(ctx.p(EDGE_ENV)) or ""
    for line in text.splitlines():
        if line.startswith("POLY_BIND_ADDR="):
            return line.split("=", 1)[1]
    return None


def digest_of(rdir):
    return "sha256:" + os.path.basename(os.path.normpath(rdir))[len("sha256-"):]


def guard(project, ctx, rdir, images, restore=False, keep=False):
    """F4: the isolated render of the release's compose file is corrected, judged, saved and rendered once more; -> the Judged record that every
    `up` and `run` of this release then names (never a bundle's file)."""
    env_files = ["%s/images.env" % rdir] + ([ctx.p(EDGE_ENV)] if project == "edge" else [])
    return compose_guard.judge(ctx, rdir, project, env_files, images, digest_of(rdir), bind_addr(ctx), restore=restore, keep=keep)


def edge_domain(ctx):
    text = rel.ts.read_text(ctx.p(EDGE_ENV)) or ""
    for line in text.splitlines():
        if line.startswith("POLY_DOMAIN="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


# ---- R6 steps 2-9 ----
def _compose(ctx, argv, timeout=600):
    try:
        return ctx.run(argv, timeout=timeout)
    except TimeoutError:
        return 124, "", "timeout"


GONE = ("no such object", "no such container")  # matched case-insensitively: Docker 29 says `error: no such object: <name>`


def _gone(ctx, name):
    """G4: gone is exactly `docker inspect` exiting non-zero with `No such object` or `No such container` on stderr. Anything else, a timeout
    included, is not gone, and it is asked again 5 s apart for 60 s (the locks are held meanwhile)."""
    for i in range(13):
        try:
            code, _, err = ctx.run(["docker", "inspect", name], timeout=30)
            if code != 0 and any(m in err.lower() for m in GONE):
                return True
        except (TimeoutError, OSError):
            pass
        if i < 12:
            ctx.sleep(5)
    return False


def _remove_oneoff(ctx, name):
    try:
        ctx.run(["docker", "rm", "-f", name], timeout=60)
    except (TimeoutError, OSError):
        pass
    if not _gone(ctx, name):
        raise Refusal("oneoff-stuck", True)


def _oneoff(ctx, project, judged, svc, command, timeout=600, timeout_refusal=None):
    """F15: a one-off run is named; a stale one is removed first; on a timeout it is removed and must be gone before the lock is released. A client timeout
    is the refusal `timeout_refusal` when one is named (no quarantine), else the answer 124 as before."""
    name = stack.oneoff_name(project, svc)
    _remove_oneoff(ctx, name)  # a stale one that will not go: a later run refuses while it exists
    try:
        return ctx.run(stack.run_argv(judged, project, svc, command), timeout=timeout)
    except TimeoutError:
        _remove_oneoff(ctx, name)
        if timeout_refusal:
            raise Refusal(timeout_refusal)
        return 124, "", "timeout"


def _roll_out(project, ctx, rdir, digest, tag, commit, cur, first, existing_data, owner, fresh, judged, run):
    cdir = rel.release_dir(ctx, cur["digest"]) if cur else rdir  # only a first deploy, with no `current`, starts the candidate's Postgres
    try:
        rows = compose.ps(ctx, "polycarpic-" + project)  # G3: one `ps`, its answer carried; a failed or unparsable one stops the run
    except (TimeoutError, OSError):
        rows = None
    if rows is None:
        raise Refusal("ps")
    pj = None if cur else judged[project]  # with a `current`, Postgres only ever starts from current's judged render; the candidate's is for a first deploy
    if cur and not compose.running(rows, "postgres"):  # current's bundle is judged before any container of it is started (S3, S12)
        if not rel.owned_safely(ctx, cdir):
            raise Refusal("release-tree")
        try:
            pj = guard(project, ctx, cdir, stack.kinds(stack.refs(cdir)))
        except Refusal as err:  # F11: current's fault is not the candidate's: alert, no Q, the name only
            if err.name.startswith("guard-"):
                raise Refusal("current-" + err.name)
            raise
    rerun = first and not cur and not existing_data and rel.read(ctx, project, "first-attempt") is not None  # an earlier attempt of this project
    if fresh:  # an empty data directory and no `current`: a rerun after `roles-missing` may proceed without --existing-data
        rel.put(ctx, project, "first-attempt", rel.now_utc(ctx) + "\n")
    _start_postgres(project, ctx, pj, cdir, rows)
    if not cur:
        _check_roles(project, ctx, pj)  # G12: a fresh Postgres without poly_migrator is `roles-missing`, before any backup or one-off
    # S19: a rerun skips the backup only when its own earlier attempt left an empty database; a table, or a failed or unparsable read, requires it
    backup_needed = bool(cur or existing_data or (rerun and not _database_empty(project, ctx, pj)))
    if project == "prod" and backup_needed:
        try:
            _premigration(project, ctx)
        except Refusal:
            if rerun:
                ctx.err("run: sudo polycarpic-ops provision --stage database --project " + project)
            raise
    backup_fd = None
    if project == "prod":
        backup_fd = spool.lock(ctx, "backup.lock", wait=30 * 60)
        if backup_fd is None:
            raise Refusal("backup-lock")
    try:
        return _apply(project, ctx, rdir, digest, tag, commit, cur, first, owner, judged, run)
    finally:
        if backup_fd is not None:
            os.close(backup_fd)


def _start_postgres(project, ctx, pj, cdir, rows):
    if compose.running(rows, "postgres"):
        return
    code, _, _ = _compose(ctx, stack.up_argv(pj, project, ["postgres"], ["--no-deps"]))
    if code != 0 or not stack.wait_healthy(ctx, project, cdir, ["postgres"], check_http=False, judged=pj):
        raise Refusal("postgres-start")


SQL_ROLE = ("SET default_transaction_read_only = on;\n"
            "SELECT count(*) FROM pg_roles WHERE rolname = 'poly_migrator';\n")


def _check_roles(project, ctx, pj):
    """G12: with no `current`, right after Postgres is healthy, ask over the container's local socket whether poly_migrator exists. `migrate --plan`
    cannot tell: a missing role is 28P01, the same answer as a wrong password, and the tool never reads meaning into that. Exactly 0 is
    `roles-missing` (the provision command, exit 4, no quarantine, no one-off started); exactly 1 goes on; anything else is `roles-read` (no quarantine)."""
    argv = stack.base(pj, project) + ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "postgres", "-XAtq", "-v", "ON_ERROR_STOP=1"]
    try:
        code, out, _ = ctx.run(argv, stdin=SQL_ROLE, timeout=30)
    except (TimeoutError, OSError):
        raise Refusal("roles-read")
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    answer = lines[0] if code == 0 and len(lines) == 1 else None  # exactly one line and a clean exit; two lines, garbage or a failing exit are `roles-read`
    if answer == "1":
        return
    if answer == "0":
        ctx.err("run: sudo polycarpic-ops provision --stage database --project " + project)
        raise Refusal("roles-missing", code=4)
    raise Refusal("roles-read")


SQL_TABLES = ("SET default_transaction_read_only = on;\n"
              "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
              "WHERE c.relkind IN ('r','p','f','m') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast';\n")


def _database_empty(project, ctx, pj):
    """True only when the project's database holds no table outside the system schemas, read over the container's local socket."""
    argv = stack.base(pj, project) + ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "polycarpic", "-XAtq", "-v", "ON_ERROR_STOP=1"]
    try:
        code, out, _ = ctx.run(argv, stdin=SQL_TABLES, timeout=30)
    except TimeoutError:
        return False
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    return code == 0 and bool(lines) and lines[-1] == "0"


def _premigration(project, ctx):
    try:
        code, out, _ = ctx.run(["/usr/local/sbin/polycarpic-ops", "backup", "premigration"], timeout=BACKUP_TIMEOUT)
    except TimeoutError:
        raise Refusal("premigration-timeout")
    last = (out.strip().splitlines() or [""])[-1]
    if code != 0:
        raise Refusal("premigration-%d" % code)
    if not stack.PREMIGRATION.fullmatch(last):
        raise Refusal("premigration-malformed")
    rel.log(ctx, project, "premigration-set", last.split(" ", 1)[1])


def _apply(project, ctx, rdir, digest, tag, commit, cur, first, owner, judged, run):
    for svc in stack.APP_SERVICES:
        code, _, _ = _oneoff(ctx, project, judged[project], svc, [svc, "check-config"], timeout=CHECK_CONFIG_TIMEOUT, timeout_refusal="check-config-timeout")
        if code != 0:
            raise Refusal("check-config", True)
    code, out, err = _oneoff(ctx, project, judged[project], "migrate", ["migrate", "--plan"])
    if code == 2 and first and "roles-missing" in out + err:
        ctx.err("run: sudo polycarpic-ops provision --stage database --project " + project)
        raise Refusal("roles-missing", code=4)
    if code == 3:
        code, _, _ = _oneoff(ctx, project, judged[project], "migrate", ["migrate"], timeout=MIGRATE_TIMEOUT)
        if code == 124:
            raise Refusal("migrate-timeout", True)
        if code == 4:
            raise Refusal("migrate-4")
        if code != 0:
            raise Refusal("migrate-%d" % code, True)
        rel.log(ctx, project, "migrated", digest)
    elif code == 2:
        raise Refusal("plan-diverged", True)
    elif code != 0:
        raise Refusal("plan-error")
    owns = bool(owner)  # edge is prod's alone (R9 strict)
    probe, baseline_ok = _probe_baseline(project, ctx, first)
    live_probe = probe if baseline_ok else None  # F10: the probe is required only when the baseline was 200, on every path
    run["owns"], run["probe"] = owns, live_probe
    rel.put(ctx, project, "in-progress", digest + "\n")  # marks the candidate's first `up` (F2)
    run["up"] = True
    if owns:
        code = _edge_up(ctx, judged.get("edge"), digest)
        if code != 0:
            return _rollback_auto(project, ctx, digest, cur, owns, live_probe, run=run)
    code, _, _ = _compose(ctx, stack.up_argv(judged[project], project))
    _note(ctx, project, "up", digest)
    up_ok = code == 0 and stack.wait_healthy(ctx, project, rdir, stack.services_for(project), extra=live_probe, judged=judged[project])
    if up_ok and owns:
        up_ok = stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False, extra=live_probe, judged=judged["edge"])
    if up_ok:
        code = _healthy(project, ctx, rdir, digest, tag, commit, cur, run)
        if probe and not baseline_ok:  # A13: the probe was not required, and the alert says so even when healthy
            try:
                rel.alert(ctx, project, "edge-probe-baseline")
            except Exception:
                pass
        return code
    return _rollback_auto(project, ctx, digest, cur, owns, live_probe, run=run)


def _probe_baseline(project, ctx, first):
    """A13: prod, real-domain mode, not the first deploy. -> (probe callable or None, baseline was 200). The baseline is asked once before step 8."""
    if project != "prod" or first:
        return None, False
    host_env = rel.ts.read_text(ctx.p("/etc/polycarpic/host.env")) or ""
    if "TLS_MODE=real-domain" not in host_env.splitlines():
        return None, False
    dom = edge_domain(ctx)
    addr = bind_addr(ctx)
    if not dom or not addr:
        return None, False
    host = "app." + dom
    addr = "127.0.0.1" if addr == "0.0.0.0" else addr

    def probe():
        try:
            return ctx.https_status(host, addr, "/api/v1/health") == 200
        except (OSError, TimeoutError):
            return False

    ok = probe()
    if not ok:
        rel.log(ctx, project, "edge-probe-baseline", host)
    return probe, ok


def _edge_up(ctx, judged, digest):
    """R9: bring the shared Caddy up from the judged edge render. F9: it takes the guard's Judged record and the digest it is about to start, and checks
    the type, the project, the digest and the file's sha256 (re-read) before any compose call; a miss is the refusal `unjudged`."""
    compose_guard.verify(judged, "edge", digest)
    code, _, _ = _compose(ctx, stack.up_argv(judged, "edge", ["caddy"]))
    return code


def _healthy(project, ctx, rdir, digest, tag, sha, cur, run):
    commit(project, ctx, cur, dict(digest=digest, tag=tag, commit=sha), run)
    return 0 if settle(project, ctx, rdir, digest) else 1


def link_current(ctx, project, rdir):
    link = ctx.p("%s/%s-current" % (rel.RELEASES, project))
    tmp = link + ".new"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    os.symlink(os.path.basename(rdir), tmp)
    os.replace(tmp, link)


def _prune(ctx):
    """Removes only releases no pointer names; an unreadable or damaged pointer counts as naming all, so nothing is removed (F3)."""
    keep = set()
    try:
        prod_has_current = bool(rel.load_pointer(ctx, "prod", "current"))
        # edge's current and previous are kept only until prod has a `current` (R4, R9): after that Caddy comes from prod's releases
        for project in ("prod", "staging") + (() if prod_has_current else ("edge",)):
            for name in ("current", "previous"):
                p = rel.load_pointer(ctx, project, name)
                if p:
                    keep.add("sha256-" + p["digest"].split(":", 1)[1])
    except Refusal:
        return
    root = ctx.p(rel.RELEASES)
    for name in os.listdir(root):
        if name.startswith("sha256-") and name not in keep:
            rel.remove_tree(os.path.join(root, name))
    kept = set(n[len("sha256-"):][:12] for n in keep)
    for project in ("prod", "staging", "edge"):  # A17: a saved render goes with its release, and no other is touched
        sdir = ctx.p("%s/%s" % (compose_guard.STATE, project))
        if not os.path.isdir(sdir):
            continue
        for name in os.listdir(sdir):
            m = re.fullmatch(r"render-([0-9a-f]{12})\.(json|sha256)", name)
            if m and m.group(1) not in kept:
                try:
                    os.unlink(os.path.join(sdir, name))
                except OSError:
                    pass


def unwind(project, ctx, digest, restore_fn, reason=None, why=None, run=None):
    """G2: the one exit of a run that started something and did not end healthy. Restore first; a restore that did not answer True stops the candidate's
    services (R1.1); then quarantine, log, alert and clearing `in-progress`, each in its own `try`. `in-progress` is cleared only by a restore that answered
    True, or with no `current` once the candidate is stopped, and only after the quarantine line is on disk; every other exit keeps it. The exit is never 0."""
    cur = run.get("cur") if run else None
    try:
        res = restore_fn()
    except Exception:
        res = False
    ok = res is True or (res is not False and not isinstance(res, str) and bool(res))
    stopped = True
    if not ok:
        stopped = stand_down(project, ctx, _keep_ref(project, ctx, cur))
    name = "rolled-back" if ok else "rollback-unhealthy"
    q_ok = True
    if reason:
        try:
            rel.quarantine(ctx, project, digest, reason)
        except Exception:
            q_ok = False
    try:
        if why or reason:
            rel.log(ctx, project, "refused", why or reason, digest)
        rel.log(ctx, project, name, digest)
    except Exception:
        pass
    shown = name if ok else ("not-stopped" if not stopped else (res if isinstance(res, str) else name))
    try:
        rel.alert(ctx, project, shown)
    except Exception:
        pass
    ctx.err("deploy: " + shown)
    if q_ok and (ok or (not cur and stopped)):
        try:
            _unlink(ctx, project, "in-progress")
        except OSError:
            pass
    return 1


def _rollback_auto(project, ctx, digest, cur, owns=False, probe=None, reason="unhealthy", why=None, run=None):
    """R8: the candidate did not end healthy; put `current` back from its own release, never migrating."""
    def back():
        if cur is None:
            if project == "prod" and owns:  # a first prod deploy that ups Caddy and fails puts Caddy back on edge's `current` (S23); the outcome stays unhealthy
                _caddy_back(project, ctx)
            return False
        return _restore_cur(project, ctx, cur, probe=probe)
    return unwind(project, ctx, digest, back, reason, why, run)


def restore(project, ctx, ptr, owns=None, probe=None, keep=False):
    """Bring a recorded release back up: its directory safely owned (F8), tree-hash re-check, the guard on its render, `up`, health.
    -> True when healthy. Edge is prod's alone (R9 strict): a prod rollback restores Caddy too, a staging one never names it."""
    rdir = rel.release_dir(ctx, ptr["digest"])
    if not os.path.isdir(rdir) or not rel.owned_safely(ctx, rdir):
        return False
    try:
        if stack.tree(rdir) != ptr["tree"]:
            return False
    except Refusal:
        return False
    owner = project == "prod"
    if owner and sauth.check(ctx):  # nothing is upped when the staging-auth file is wrong (S30)
        return False
    try:
        images = stack.kinds(stack.refs(rdir))
        pj = guard(project, ctx, rdir, images, restore=True, keep=keep)  # rollback renders and judges in memory; it writes only when the bytes differ (S36)
        ej = guard("edge", ctx, rdir, images, restore=True, keep=keep) if owner else None  # both renders are judged before either `up`
    except Refusal:
        return False
    code, _, _ = _compose(ctx, stack.up_argv(pj, project))
    ok = code == 0 and stack.wait_healthy(ctx, project, rdir, stack.services_for(project), extra=probe, judged=pj)
    if owner:
        try:
            code = _edge_up(ctx, ej, ptr["digest"])
        except Refusal:
            return False
        ok = ok and code == 0 and stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False, extra=probe, judged=ej)
    return ok
