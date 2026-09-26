"""POLY-56 gate-1 ruling § R1: build_board_payload stamps a server-side
`issue["checklist"] = {"done": k, "total": n}` on every issue (one Python
parser, cairn.checklist_items, feeding both the card badge and the
drawer -- "two parsers become one"), and build_issue_payload stamps
`issue["checklist_items"] = [{ordinal, text, checked}]`. Also pins the
caller wiring the ruling's review checklist calls out by name: items
inside a `## Comments` section must never be counted, because both
payload builders must parse the split_comments PRE-half, never the raw
body.
"""
from __future__ import annotations

import unittest
from pathlib import Path

import helpers  # noqa: F401

import cairn


ISSUE_TMPL = (
    "---\nid: {id}\ntitle: {title}\nstatus: {status}\nmilestone: null\nparent: null\n"
    "assignee: null\nlabels: []\npriority: null\npr: null\n"
    "created: 2026-01-01\nupdated: 2026-01-01\n---\n\n{body}"
)


def _tree(testcase) -> Path:
    tmp = helpers.make_empty_tmp_dir(testcase)
    data_dir = tmp / "cairn"
    for sub in ("issues", "archive/issues", "milestones", "majors"):
        (data_dir / sub).mkdir(parents=True)
    (data_dir / "config.yml").write_text("prefix: PT\nport: 8766\ndata_dir: process/cairn\n", encoding="utf-8")
    return data_dir


def _write_issue(data_dir: Path, issue_id: str, body: str, status: str = "todo", title: str = "Thing") -> Path:
    p = data_dir / "issues" / f"{issue_id}.md"
    p.write_text(ISSUE_TMPL.format(id=issue_id, title=title, status=status, body=body), encoding="utf-8")
    return p


class BoardPayloadChecklistCountTests(unittest.TestCase):
    def test_board_payload_counts_done_and_total_separately(self):
        # Mutation (ruling's review checklist): count `total` as done --
        # a 1-of-3 checklist must read {done: 1, total: 3}, never {done:
        # 3, total: 3} or any other collapse of the two numbers together.
        data_dir = _tree(self)
        _write_issue(
            data_dir, "PT-1",
            "Para.\n\n## Acceptance criteria\n\n- [x] one\n- [ ] two\n- [ ] three\n",
        )
        payload = cairn.build_board_payload(data_dir)
        issue = next(i for i in payload["issues"] if i["id"] == "PT-1")
        self.assertEqual(issue["checklist"], {"done": 1, "total": 3})
        self.assertNotEqual(issue["checklist"]["done"], issue["checklist"]["total"])

    def test_board_payload_checklist_is_zero_zero_with_no_ac_section(self):
        # PT-3's no-conditional-payload-shape precedent, applied here:
        # `checklist` is always present, never absent, even when there is
        # nothing to count.
        data_dir = _tree(self)
        _write_issue(data_dir, "PT-1", "Just a description, no checklist at all.\n")
        payload = cairn.build_board_payload(data_dir)
        issue = next(i for i in payload["issues"] if i["id"] == "PT-1")
        self.assertEqual(issue["checklist"], {"done": 0, "total": 0})

    def test_board_payload_checklist_ignores_items_filed_inside_comments(self):
        # The wiring half of "items inside comments ignored": the payload
        # builder must feed cairn.checklist_items the split_comments
        # PRE-half, never the raw body -- a checklist-shaped line inside
        # '## Comments' must not inflate the count.
        data_dir = _tree(self)
        _write_issue(
            data_dir, "PT-1",
            "Para.\n\n## Acceptance criteria\n\n- [ ] real item\n\n"
            "## Comments\n\n### @qa-engineer — 2026-01-01\n\n- [ ] fake item inside a comment\n",
        )
        payload = cairn.build_board_payload(data_dir)
        issue = next(i for i in payload["issues"] if i["id"] == "PT-1")
        self.assertEqual(issue["checklist"], {"done": 0, "total": 1})


class IssuePayloadChecklistItemsTests(unittest.TestCase):
    def test_issue_payload_carries_checklist_items_shape(self):
        data_dir = _tree(self)
        _write_issue(
            data_dir, "PT-1",
            "Para.\n\n## Acceptance criteria\n\n- [ ] first\n- [x] second\n",
        )
        issue = cairn.build_issue_payload(data_dir, "PT-1")
        self.assertEqual(len(issue["checklist_items"]), 2)
        self.assertEqual(issue["checklist_items"][0]["ordinal"], 1)
        self.assertEqual(issue["checklist_items"][0]["text"], "first")
        self.assertFalse(issue["checklist_items"][0]["checked"])
        self.assertEqual(issue["checklist_items"][1]["ordinal"], 2)
        self.assertTrue(issue["checklist_items"][1]["checked"])

    def test_issue_payload_checklist_items_ignores_items_filed_inside_comments(self):
        data_dir = _tree(self)
        _write_issue(
            data_dir, "PT-1",
            "Para.\n\n## Acceptance criteria\n\n- [ ] real item\n\n"
            "## Comments\n\n### @qa-engineer — 2026-01-01\n\n- [ ] fake item inside a comment\n",
        )
        issue = cairn.build_issue_payload(data_dir, "PT-1")
        self.assertEqual(len(issue["checklist_items"]), 1)
        self.assertEqual(issue["checklist_items"][0]["text"], "real item")


if __name__ == "__main__":
    unittest.main()
