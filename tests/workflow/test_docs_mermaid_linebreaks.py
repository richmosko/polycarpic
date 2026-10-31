"""POLY-79a: Mermaid node labels authored with `<br/>` must render as two lines.

Approach: a REAL render. Serve docs/ with scripts/serve-docs.py, load ARCH in
headless Chrome (the same binary search as scripts/export-pdf.sh), dump the DOM,
and assert the labels are not run together. A static loader-config test would
not do: investigation showed the cause is NOT htmlLabels/loader config (forcing
htmlLabels:true still yields "Off-boxbackup"). Root cause: the docs put the
source in `<pre class="mermaid">` as raw `<br/>`; the HTML parser turns that
into a real <br> element, and mermaid-init.js captures `el.textContent`
(dataset.source) and Mermaid reads textContent too, both of which drop element
nodes, so the break vanishes before Mermaid sees it. The assertion is fix-agnostic
(escape the source, or have the loader rebuild it).

Skipped when no headless Chrome is installed (the CDN-backed Mermaid also needs
network); it is not a CI test today.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import unittest

import workflow_helpers
from test_docs_server_restart import free_port, start, stop, wait_serving


def find_chrome() -> str | None:
    home = os.path.expanduser("~")
    cands = [shutil.which("chrome-headless-shell")]
    cands += sorted(glob.glob(f"{home}/.cache/puppeteer/chrome-headless-shell/*/*/chrome-headless-shell"), reverse=True)
    cands += [
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        shutil.which("chromium"), shutil.which("google-chrome"),
    ]
    return next((c for c in cands if c and os.path.exists(c)), None)


class MermaidLineBreakTests(unittest.TestCase):
    def test_arch_labels_break_onto_two_lines(self):
        chrome = find_chrome()
        if not chrome:
            self.skipTest("no headless Chrome found")
        port = free_port()
        srv = start(port)
        try:
            self.assertTrue(wait_serving(srv, port), "docs server did not start")
            dom = subprocess.run(
                [chrome, "--no-sandbox", "--virtual-time-budget=15000", "--dump-dom",
                 f"http://127.0.0.1:{port}/ARCH/"],
                capture_output=True, text=True, timeout=90,
            ).stdout
        finally:
            stop(srv)
            if srv.stderr:
                srv.stderr.close()
        self.assertTrue("Off-box" in dom and "<svg" in dom, "diagram did not render")
        for run_together in ("Off-boxbackup", "Web app+ API", "Login IdPs,Resend"):
            self.assertFalse(run_together in dom, f"<br/> dropped: {run_together!r} rendered run together")


if __name__ == "__main__":
    unittest.main()
