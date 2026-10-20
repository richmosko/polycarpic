"""cairnlib.server — HTTP server: a lens, not a source of truth. No state
held here.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 18).
"""

import datetime
import hashlib
import http.server
import json
import os
import queue
import socketserver
import sys
import threading
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional

from cairnlib.constants import CAIRNLIB_DIR, BOARD_DIR, DASHBOARD_DIR, DEFAULT_PORT, DEFAULT_STATUS
from cairnlib.errors import BadParentError, CairnError, LegacyArchiveError
from cairnlib.records import append_comment, apply_patch, get_seen
from cairnlib.config import load_config
from cairnlib.store import allocate_and_create_issue, find_issue_path, find_record_path, is_archived_path, _record_schema_for_path
from cairnlib.flow import build_flow_payload
from cairnlib.tokens import build_tokens_payload_cached
from cairnlib.payloads import (
    _validate_record_patch,
    build_dashboard_payload,
    build_issue_payload,
    build_record_payload,
    build_roster_payload,
)
from cairnlib.multiroot import Root, build_multi_board_payload, compute_multi_etag, find_issue_in_roots, find_record_in_roots, resolve_roots
from cairnlib.watch import DataDirWatcher, _SSEBroadcaster, _dashboard_is_servable, _is_embed_request, engine_fingerprint, engine_is_stale

__all__ = ["make_server"]


def make_server(
    data_dir: Path,
    config: Optional[Dict[str, Any]] = None,
    port: Optional[int] = None,
    roots: Optional[List[Root]] = None,
    source_path: Path = CAIRNLIB_DIR,
    dashboard_dir: Path = DASHBOARD_DIR,
):
    """Build (but do not start) the board's HTTPServer, bound to 127.0.0.1.

    port=0 -> ephemeral (read back via server.server_address[1]).
    port=None -> load_config(data_dir)["port"].
    Caller owns serve_forever() so tests can run it in a thread.

    PT-3: `roots`, when omitted (`None`), is synthesised by calling
    `resolve_roots(data_dir, config)` -- the exact same function multi-root
    callers use -- so single-root behaviour (the overwhelming majority of
    callers: every existing test, `cmd_serve` without `--repos`) is
    exercised by the *same* code path multi-root uses, not a separate one
    that could silently drift. `cmd_serve` resolves roots itself (for its
    startup banner) and passes the result in explicitly.

    PT-49 (§9's required test seam): `source_path` defaults to
    `CAIRNLIB_DIR` (POLY-58 §4: post-split, the engine's own code lives
    in the `cairnlib/` package, not in this one file) -- a real server
    fingerprints the actual running engine with zero caller effort -- but
    is overridable so a test can point it at a throwaway file/dir and
    rewrite THAT, never the live, imported package. Fingerprinted exactly
    once here, at construction (§2's "boot" fingerprint); every later
    `/api/board` build re-checks against it via `engine_is_stale`, never
    re-fingerprints from scratch.

    PT-54 (architect ruling §4): `dashboard_dir` defaults to the real
    committed `DASHBOARD_DIR` -- overridable so a test can exercise the
    missing-dist 503 branch (or serve a throwaway fixture) without
    touching the real `scripts/cairn/dashboard/dist/`, same seam
    `source_path` already established.
    """
    data_dir = Path(data_dir)
    dashboard_dir = Path(dashboard_dir)
    if config is None:
        config = load_config(data_dir)
    if port is None:
        port = int(os.environ.get("CAIRN_PORT", config.get("port", DEFAULT_PORT)))
    if roots is None:
        roots, root_warnings = resolve_roots(data_dir, config)
    else:
        root_warnings = []
    host = "127.0.0.1"

    # PT-49 §2: captured once, held on the handler closure below, compared
    # against on every /api/board build (§3) -- never recomputed here.
    engine_boot = engine_fingerprint(source_path)
    engine_started_at = datetime.datetime.now().isoformat()

    # PT-1: Server is per-connection threaded (ThreadingMixIn below) so a
    # held-open SSE connection can't starve the accept loop for every
    # other client. That's a real behavior change from the old
    # single-threaded HTTPServer, where request handling was inherently
    # serialized -- two concurrent POST /api/issue/<id> on the *same*
    # issue could never race, because the server processed one full
    # request/response cycle at a time. Once concurrent request threads
    # are possible, that serialization has to be re-created explicitly:
    # write_lock below serializes only the mutate path (the
    # seen-check-then-write critical section), so two concurrent writers
    # to the same issue can't both pass the staleness check against the
    # same pre-write state and silently lose one of their patches. Reads
    # (GET /api/board, GET /api/issue/<id>, the SSE stream) stay fully
    # concurrent -- only writes serialize. allocate_and_create_issue's own
    # O_EXCL retry loop already makes concurrent *creates* safe without
    # this lock (each gets a distinct ID), so _create_issue isn't wrapped.
    write_lock = threading.Lock()

    # PT-1: watcher lifecycle is bound to make_server itself (server
    # object exists => watching), not to cmd_serve -- so every test (and
    # every other caller) that builds a server via make_server gets a
    # live watcher for free. Baseline snapshot happens synchronously
    # inside DataDirWatcher.__init__, below, before .start() is called.
    broadcaster = _SSEBroadcaster()
    watcher = DataDirWatcher(roots, broadcaster)

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "cairn/1.0"

        def log_message(self, fmt, *fmt_args):  # noqa: A003
            # PT-34 (architect's E0 prerequisite, ruled permanent): the
            # prior override discarded every argument log_request/log_error
            # pass through fmt_args, including the HTTP status code -- a
            # request that returned 200 and one that returned 503 produced
            # an identical server-log line. That gap is what turned this
            # investigation into an afternoon of Chrome-side reasoning
            # instead of a grep. BaseHTTPRequestHandler.log_request's own
            # call shape (kept here as the reference format) is
            # `log_message('"%s" %s %s', requestline, code, size)` --
            # fmt_args[1] is the status code on that path.
            #
            # PT-31 (architect's comment-accuracy fix, item 8): the
            # previous version of this comment claimed any OTHER call
            # shape (log_error, etc.) "degrades to the terse form" -- that
            # is false. log_error's own call shape is
            # `log_message("code %d, message %s", code, message)`, so at
            # fmt_args[1] it carries the MESSAGE ("Not Found"), not a
            # status code -- that string lands in this line's status
            # column verbatim, not a "-" placeholder. Harmless for E0's
            # actual purpose (the real numeric status still appears on
            # log_request's own line for the same request), but the prior
            # comment described a fallback that doesn't exist. No
            # format-string guard added to distinguish the two shapes --
            # that would couple this handler to a CPython stdlib internal
            # (the exact positional args http.server happens to pass)
            # for a cosmetic gain on an already-non-blocking log line.
            status = fmt_args[1] if len(fmt_args) >= 2 else "-"
            sys.stderr.write("  %s %s %s\n" % (self.command, self.path, status))

        def _send_json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _send_static(self, rel_path: str, base: Path = BOARD_DIR) -> None:
            # PT-54 (architect ruling §4): widened to take `base` so the
            # dashboard's static assets go through the SAME traversal
            # guard as the board's (BOARD_DIR stays the default -- every
            # pre-PT-54 caller is unaffected).
            target = (base / rel_path).resolve()
            try:
                target.relative_to(base.resolve())
            except ValueError:
                self.send_error(403)
                return
            if not target.is_file():
                self.send_error(404)
                return
            content_type = {
                ".html": "text/html; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".woff2": "font/woff2",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".ico": "image/x-icon",
                ".json": "application/json",
                ".map": "application/json",
            }.get(target.suffix, "application/octet-stream")
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            # PT-49 §7: closes the browser-cache half of staleness cheaply
            # -- matches what /api/board already sends. No client-side
            # asset-version handshake: with no-store, a stale board.js/
            # board.css is not a reachable state, so there is nothing left
            # for a handshake to protect against.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _send_dashboard_unbuilt_503(self) -> None:
            """PT-54 (architect ruling §3/§4): the dashboard's `dist/` is
            COMMITTED, never built at serve time -- when it's missing (a
            clone that hasn't run `npm ci && npm run build` under
            `scripts/cairn/dashboard/` specifically; the rest of `cairn
            serve` needs nothing but python3), name the literal fix
            rather than a bare 404/500. `/api/dashboard` is unaffected --
            it's pure python, no build dependency.
            """
            body = (
                "<!doctype html><html><head><title>Dashboard not built</title></head>"
                "<body><h1>503 &mdash; Dashboard not built</h1>"
                "<p>Run <code>cd scripts/cairn/dashboard &amp;&amp; npm ci &amp;&amp; "
                "npm run build</code>, then restart <code>cairn serve</code>.</p>"
                "</body></html>"
            ).encode("utf-8")
            self.send_response(503)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _handle_sse(self) -> None:
            """GET /api/events -- an SSE stream. Holds the connection
            open (no Content-Length, no keep-alive) and pushes one
            `data: <json>\\n\\n` frame per broadcaster event -- coarse
            per team-lead's ruling: the frame's contents (created/
            changed/removed path lists) are informational only, the
            client refetches the whole board on any event, never a
            per-id targeted diff.

            A 30s heartbeat comment (standard SSE keep-alive cadence)
            bounds how long a dead connection's thread can sit blocked
            on q.get() with nothing to detect the disconnect -- 30s is
            comfortably above every test's read-timeout budget (this is
            a localhost single-user tool, not proxied through anything
            with its own idle-connection timeout, so nothing here is
            tuned to the test suite's timing). A write failure on either
            a heartbeat or a real event (client gone) ends the loop and
            unsubscribes.
            """
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            q = broadcaster.subscribe()
            try:
                while True:
                    try:
                        event = q.get(timeout=30.0)
                    except queue.Empty:
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
                        continue
                    body = json.dumps(event).encode("utf-8")
                    self.wfile.write(b"data: " + body + b"\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                broadcaster.unsubscribe(q)

        def do_GET(self):  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            if path == "/api/board":
                # PT-42 (ruling § 1): `?archived=1` is the ONLY accepted
                # spelling -- absent, empty, or any other value is OFF, so
                # a typo'd/garbage query param can never accidentally
                # trigger the 28x-cost archive/ read. `parse_qs` (not a
                # hand-split on "&"/"="): stdlib, handles the usual query-
                # string edge cases (repeated keys, missing values, url-
                # decoding) this endpoint doesn't otherwise need to worry
                # about the first time it grows a query param at all.
                query = urllib.parse.parse_qs(parsed.query)
                archived = query.get("archived", [""])[0] == "1"
                # PT-49 §3/§5: the self-check runs on EVERY build (cheap:
                # one stat in the common case), folded into the etag (§5,
                # the part that would otherwise silently defeat the whole
                # feature -- without it a stale flip with no data change
                # 304s forever and the banner never appears).
                engine_stale = engine_is_stale(source_path, engine_boot)
                engine_status = {
                    "source_sha": engine_boot["sha"],
                    "started_at": engine_started_at,
                    "stale": engine_stale,
                }
                etag = compute_multi_etag(
                    roots, archived=archived, boot_sha=engine_boot["sha"], source_path=source_path
                )
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                payload = build_multi_board_payload(
                    roots, root_warnings, archived=archived, engine=engine_status
                )
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path.startswith("/api/issue/"):
                issue_id = urllib.parse.unquote(path[len("/api/issue/"):])
                # PT-3: read side is roots-aware -- an issue from ANY
                # loaded root is readable, stamped with which root it came
                # from and whether that root is writable. The write side
                # (_mutate_issue below) is deliberately NOT roots-aware in
                # the same way -- that asymmetry is the read-only guarantee.
                owning_root = find_issue_in_roots(roots, issue_id)
                if owning_root is None:
                    self._send_json(404, {"error": "not_found", "message": f"no such issue: {issue_id}"})
                    return
                payload = build_issue_payload(owning_root.path, issue_id)
                payload["repo"] = owning_root.id
                # PT-42 (ruling § 5): folds the archived stamp
                # build_issue_payload already computes into the SAME
                # read_only flag a foreign-root issue gets -- the drawer's
                # inline editors already suppress on this one flag (PT-3),
                # so an archived issue's read-only-ness needs no second
                # client-side flag to check.
                payload["read_only"] = (not owning_root.primary) or payload["archived"]
                self._send_json(200, payload)
                return
            if path == "/api/events":
                self._handle_sse()
                return
            if path == "/api/dashboard":
                # PT-54 (architect ruling §4): primary-root only -- git
                # state is inherently single-repo, there is no multi-root
                # "current branch". Same ETag/no-store posture as
                # /api/board, but hashing the SERIALIZED BODY (the
                # ruling's own words: "cheap to write") rather than a
                # file-mtime fold -- every field here already comes from
                # either a bounded git subprocess or a fresh parse, so
                # there's no cheaper fingerprint to reuse.
                payload = build_dashboard_payload(roots[0].path)
                body = json.dumps(payload).encode("utf-8")
                # `generated_at` is excluded from the hash input --
                # otherwise every request's own timestamp would change
                # the ETag, defeating 304 entirely even when nothing
                # else in the payload moved.
                etag_input = {k: v for k, v in payload.items() if k != "generated_at"}
                etag = hashlib.sha256(json.dumps(etag_input, sort_keys=True).encode("utf-8")).hexdigest()[:16]
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/api/roster":
                # PT-56 (architect ruling § "Where the code lives"): a
                # SEPARATE endpoint, never a key on /api/dashboard --
                # keeps PT-54's five-key payload contract intact and
                # isolates failure (an unreadable .claude/agents/ degrades
                # only this endpoint). No SSE-driven freshness: the
                # watcher scans process/cairn/ only, so a change under
                # .claude/agents/ would emit nothing regardless -- the
                # dashboard client polls this on its own cadence instead.
                payload = build_roster_payload(roots[0].path)
                self._send_json(200, payload)
                return
            if path == "/api/flow":
                # PT-61 (architect ruling): a SEPARATE endpoint from
                # /api/dashboard, same reasoning as /api/roster above --
                # different cost profile (two bounded git subprocesses on
                # a cache miss vs. a data-dir parse), different cache key
                # (HEAD sha, not the dashboard body hash), different
                # freshness cadence (polled by the client, never SSE --
                # the watcher scans process/cairn/ only, and history
                # doesn't change on a working-tree edit anyway). Degrades
                # to 200 + `series: []` + a warning, never 500 --
                # build_flow_payload never raises.
                payload = build_flow_payload(roots[0].path)
                body = json.dumps(payload).encode("utf-8")
                etag = payload.get("as_of") or hashlib.sha256(body).hexdigest()[:16]
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/api/tokens":
                # PT-79 (architect ruling § 2): a SEPARATE endpoint, same
                # PT-56/PT-61 precedent as /api/roster and /api/flow
                # above. Memoized on (mtime, size) of token-usage.jsonl
                # via build_tokens_payload_cached -- never raises,
                # degrades to warning + issues: [] for a missing or
                # unreadable metrics file (the one place "missing means
                # error" does not apply here -- the file is optional
                # data, unlike config.yml).
                payload = build_tokens_payload_cached(roots[0].path)
                body = json.dumps(payload).encode("utf-8")
                etag = payload.get("generated") or hashlib.sha256(body).hexdigest()[:16]
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/":
                # PT-73 (Mosko's ruling: "bare / loads the dashboard" +
                # architect's mechanics ruling): 302 (never 301/308 --
                # the predicate is filesystem state that CHANGES when
                # dist/ gets built or deleted, and a permanent redirect
                # would get cached past the point it stops being true,
                # with no way for the server to correct a browser that's
                # stopped asking) + Cache-Control: no-store (some
                # browsers/proxies cache 302s too). Query strings are
                # NOT forwarded -- nothing today needs to survive the
                # hop to bare /dashboard. The embed carve-out below is
                # the recursion guard _is_embed_request's own docstring
                # names -- without it, the shell's `/?embed=1` iframe
                # would redirect into /dashboard, which mounts another
                # `/?embed=1` iframe, forever.
                if _dashboard_is_servable(dashboard_dir) and not _is_embed_request(parsed.query):
                    self.send_response(302)
                    self.send_header("Location", "/dashboard")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                self._send_static("board.html")
                return
            if path in ("/list", "/board"):
                # PT-73 (architect ruling §5): `/list` was always a
                # deep-link and stays one. `/board` is new -- a never-
                # redirecting alias so the standalone Kanban view stays
                # reachable once `/` starts redirecting when dist is
                # present (board.html's Kanban tab now points here
                # instead of bare `/`, which would otherwise bounce a
                # standalone user into the dashboard mid-click).
                self._send_static("board.html")
                return
            if path.startswith("/board/"):
                self._send_static(path[len("/board/"):])
                return
            if path in ("/dashboard", "/dashboard/"):
                # PT-73 (architect ruling §2, §6): same shared predicate
                # as the `/` redirect above -- this route must never
                # itself gain a redirect, or the shared helper's "can't
                # drift" guarantee becomes a loop.
                if not _dashboard_is_servable(dashboard_dir):
                    self._send_dashboard_unbuilt_503()
                    return
                self._send_static("index.html", base=dashboard_dir)
                return
            if path.startswith("/dashboard/"):
                # PT-54 (architect ruling §4): SPA fallback, narrowly --
                # a real file wins; a no-suffix path (client-side route)
                # falls back to index.html; a SUFFIXED path that doesn't
                # exist (a missing .js/.css) stays a 404, never silently
                # becomes index.html -- "the classic hours-lost debugging
                # trap."
                if not dashboard_dir.is_dir():
                    self._send_dashboard_unbuilt_503()
                    return
                rel = path[len("/dashboard/"):]
                if (dashboard_dir / rel).is_file():
                    self._send_static(rel, base=dashboard_dir)
                elif Path(rel).suffix == "":
                    self._send_static("index.html", base=dashboard_dir)
                else:
                    self.send_error(404)
                return
            self.send_error(404)

        def do_POST(self):  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b""
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                self._send_json(400, {"error": "bad_request", "message": "invalid JSON body"})
                return

            if path == "/api/issue":
                self._create_issue(payload)
                return
            if path.startswith("/api/issue/"):
                issue_id = urllib.parse.unquote(path[len("/api/issue/"):])
                self._mutate_issue(issue_id, payload)
                return
            if path.startswith("/api/record/"):
                record_id = urllib.parse.unquote(path[len("/api/record/"):])
                self._mutate_record(record_id, payload)
                return
            self.send_error(404)

        def _create_issue(self, payload: Dict[str, Any]) -> None:
            title = payload.get("title")
            if not title:
                self._send_json(400, {"error": "bad_request", "message": "title is required"})
                return
            fields = {
                "title": title,
                "status": payload.get("status") or DEFAULT_STATUS,
                "milestone": payload.get("milestone"),
                "parent": payload.get("parent"),
                "assignee": payload.get("assignee"),
                "labels": payload.get("labels") or [],
                "priority": payload.get("priority"),
                "pr": None,
            }
            # PT-52 §3 / POLY-51 ruling §2 / POLY-48 item 7 (gate-1 ruling
            # process/cairn/reviews/POLY-48/ruling.md §1, "confirmed as filed"):
            # allocate_and_create_issue raises one of three named errors,
            # each caught before the plain-`CairnError` fallback (both
            # subclass it) so they map to distinct, truthful HTTP codes:
            #   - LegacyArchiveError (the legacy-layout guard): 400
            #     legacy_archive -- a client retry of the identical request
            #     can't fix this, only running the migration can.
            #   - BadParentError (an unresolvable/nested `--parent`, OR
            #     a..z letter exhaustion under a valid parent): 400
            #     bad_parent -- a client CAN fix this, by retrying with a
            #     different `--parent` or once a letter frees up.
            #   - anything else (e.g. the numeric path's own attempt-budget
            #     exhaustion): 409 allocation_failed -- a transient
            #     collision under concurrent allocation; retrying the same
            #     request can plausibly succeed next time.
            try:
                new_path = allocate_and_create_issue(data_dir, fields)
            except LegacyArchiveError as e:
                self._send_json(400, {"error": "legacy_archive", "message": str(e)})
                return
            except BadParentError as e:
                self._send_json(400, {"error": "bad_parent", "message": str(e)})
                return
            except CairnError as e:
                self._send_json(409, {"error": "allocation_failed", "message": str(e)})
                return
            self._send_json(200, build_issue_payload(data_dir, new_path.stem))

        def _mutate_issue(self, issue_id: str, payload: Dict[str, Any]) -> None:
            # PT-3: find_issue_path is scoped to `data_dir` (the primary
            # root) only -- structurally, not by a check that could be
            # forgotten (design note §5.1). A foreign id is truthfully
            # refused with 403 read_only_root; an id no root recognizes at
            # all is a genuine 404. find_issue_in_roots is only ever
            # called here to produce that distinction -- never to locate a
            # file to write to.
            issue_path = find_issue_path(data_dir, issue_id)
            if issue_path is None:
                foreign_root = find_issue_in_roots(roots, issue_id)
                if foreign_root is not None and not foreign_root.primary:
                    self._send_json(403, {
                        "error": "read_only_root",
                        "message": f"{issue_id} lives in root {foreign_root.id} — "
                                   "the board is read-only across roots",
                    })
                    return
                self._send_json(404, {"error": "not_found", "message": f"no such issue: {issue_id}"})
                return

            # PT-42 (ruling § 5): an id that resolves in archive/ is
            # refused 403, file untouched -- mirrors read_only_root's
            # shape exactly. find_issue_path itself is UNCHANGED (still
            # resolves archive/, same PT-3/PT-39 precedent) -- this check
            # is HTTP-only; the CLI (`cairn set`/`cairn comment`, which
            # calls find_issue_path directly, never through here) stays
            # deliberately able to write an archived issue. A drag is a
            # one-pixel gesture that would leave a live-looking issue
            # sitting in archive/, invisible the moment Show-archived goes
            # off -- un-archiving is `git mv`, deliberately.
            if is_archived_path(data_dir, issue_path):
                self._send_json(403, {
                    "error": "archived",
                    "message": f"{issue_id} is archived — read-only on the board; use the CLI instead",
                })
                return

            if "seen" not in payload:
                self._send_json(400, {
                    "error": "bad_request",
                    "message": "seen is required (send the loaded token, or explicit null to override)",
                })
                return

            # PT-1: serializes the seen-check-then-write critical section
            # across request threads -- see write_lock's docstring above
            # for why this became necessary once Server went threaded.
            with write_lock:
                seen = payload["seen"]
                current_seen = get_seen(issue_path)
                if seen is not None and str(seen) != current_seen:
                    current = build_issue_payload(data_dir, issue_id)
                    self._send_json(409, {
                        "error": "stale",
                        "message": f"{issue_id} changed on disk since you loaded it",
                        "current": current,
                    })
                    return

                patch = payload.get("patch")
                if patch:
                    apply_patch(issue_path, patch)
                comment = payload.get("comment")
                if comment:
                    append_comment(issue_path, comment.get("author", "board"), comment.get("body", ""))

                self._send_json(200, build_issue_payload(data_dir, issue_id))

        def _mutate_record(self, record_id: str, payload: Dict[str, Any]) -> None:
            """`POST /api/record/<id>` -- the milestone/major sibling of
            `_mutate_issue` (PT-51 §1). A NEW endpoint, not a widening of
            `/api/issue/<id>`: `find_issue_path` stays the only resolver
            THAT path can reach (PT-3/PT-39's structural read-only/single-
            write-path guarantee), and this one is scoped to
            `find_record_path` the same way. Six checks, in the ruled
            order -- the order is part of the ruling, not an
            implementation detail:
              1. resolve (403 read_only_root / 404 not_found)
              2. an issue id -> 400 wrong_endpoint (this is NOT a second
                 write path to issues)
              3. archived -> 403, BEFORE the seen comparison
              4. seen missing -> 400; then the critical section + 409 stale
              5. patch -> field policy (§3) -> apply_patch
              6. comment -> append_comment (§4)
            """
            # Step 1 -- same distinguishing pattern as _mutate_issue:
            # find_record_path is data_dir- (primary root-) scoped by
            # construction; find_record_in_roots is ONLY ever called here
            # to tell 403 from 404, never to locate a file to write.
            record_path = find_record_path(data_dir, record_id)
            if record_path is None:
                foreign_root = find_record_in_roots(roots, record_id)
                if foreign_root is not None and not foreign_root.primary:
                    self._send_json(403, {
                        "error": "read_only_root",
                        "message": f"{record_id} lives in root {foreign_root.id} — "
                                   "the board is read-only across roots",
                    })
                    return
                self._send_json(404, {"error": "not_found", "message": f"no such record: {record_id}"})
                return

            # Step 2 -- an issue id resolves here too (find_record_path
            # searches issues/ first); rejecting it is what stops this
            # endpoint from becoming a second write path to issues with a
            # different field policy, the exact drift the single-write-
            # path rule exists to prevent.
            schema = _record_schema_for_path(data_dir, record_path)
            if schema == "issue":
                self._send_json(400, {
                    "error": "wrong_endpoint",
                    "message": f"{record_id} is an issue — use /api/issue/{record_id}",
                })
                return

            # Step 3 -- verbatim _mutate_issue's archived rule, checked
            # BEFORE the seen comparison so it holds regardless of body
            # (proven by the archived-with-a-garbage-body test).
            if is_archived_path(data_dir, record_path):
                self._send_json(403, {
                    "error": "archived",
                    "message": f"{record_id} is archived — read-only on the board; use the CLI instead",
                })
                return

            # Step 4a
            if "seen" not in payload:
                self._send_json(400, {
                    "error": "bad_request",
                    "message": "seen is required (send the loaded token, or explicit null to override)",
                })
                return

            # Step 4b/5/6 -- same write_lock critical section _mutate_issue
            # uses (write_lock serializes across BOTH endpoints; it's one
            # lock for the whole write surface, not per-endpoint).
            with write_lock:
                seen = payload["seen"]
                current_seen = get_seen(record_path)
                if seen is not None and str(seen) != current_seen:
                    current = build_record_payload(data_dir, record_id)
                    self._send_json(409, {
                        "error": "stale",
                        "message": f"{record_id} changed on disk since you loaded it",
                        "current": current,
                    })
                    return

                patch = payload.get("patch")
                if patch:
                    error = _validate_record_patch(schema, patch)
                    if error is not None:
                        self._send_json(400, error)
                        return
                    apply_patch(record_path, patch)
                comment = payload.get("comment")
                if comment:
                    append_comment(record_path, comment.get("author", "board"), comment.get("body", ""))

                self._send_json(200, build_record_payload(data_dir, record_id))

    # PT-1: ThreadingMixIn -- one thread per connection, so a long-held
    # SSE stream can't block the accept loop for every other client
    # (see write_lock above for the write-safety half of this change).
    # daemon_threads=True so a request thread (notably an open SSE
    # connection) never blocks process/test-suite shutdown.
    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        allow_reuse_address = True
        daemon_threads = True

        def server_close(self) -> None:
            # PT-1 lifecycle ruling: server close => watcher stopped.
            watcher.stop()
            super().server_close()

    server = Server((host, port), Handler)
    watcher.start()  # PT-1 lifecycle ruling: server object exists => watcher running
    return server
