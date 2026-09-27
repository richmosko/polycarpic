"use strict";

// POLY-56 gate-1 ruling (process/reviews/POLY-56/ruling.md § R1):
// splitAcceptanceCriteria moves from board.js into board-logic.js (was
// un-testable there -- no jsdom in this suite) and loses its item-parsing
// half entirely: checklist counts/items now come from the server (one
// Python parser, cairn.checklist_items, feeding both the card badge and
// the drawer) rather than a second client-side parse. What's left here is
// description-cut only: everything before the first "## Acceptance
// criteria" heading.
//
// Nothing under test exists yet in board-logic.js -- this function still
// lives in board.js today, with an `.items` half this ruling deletes.
// Every test below is expected to fail until implementation-lead's slice
// lands (INTERFACE.md documents the target contract).

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCairnLogic } = require("./helpers.js");

const CairnLogic = loadCairnLogic();

test("cuts the description at the first Acceptance criteria heading", () => {
  var desc = "Intro paragraph.\n\n## Acceptance criteria\n\n- [ ] one\n- [x] two\n";
  var result = CairnLogic.splitAcceptanceCriteria(desc);
  assert.equal(result.description, "Intro paragraph.");
});

test("returns the whole description unchanged when there is no heading", () => {
  var desc = "Just a paragraph, no acceptance criteria heading at all.\n";
  var result = CairnLogic.splitAcceptanceCriteria(desc);
  assert.equal(result.description, desc);
});

test("no longer returns an items array -- checklist items are server-stamped now", () => {
  // Mutation (restoring the deleted client-side parse): an `.items` array
  // reappearing on the return value would mean board.js's drawer is at
  // risk of reading from it again instead of issue.checklist_items.
  var desc = "Intro.\n\n## Acceptance criteria\n\n- [ ] one\n- [x] two\n";
  var result = CairnLogic.splitAcceptanceCriteria(desc);
  assert.equal(result.items, undefined);
});

test("trims trailing blank lines off the description cut", () => {
  var desc = "Intro paragraph.\n\n\n## Acceptance criteria\n\n- [ ] one\n";
  var result = CairnLogic.splitAcceptanceCriteria(desc);
  assert.equal(result.description, "Intro paragraph.");
});

test("handles a null/empty description without throwing", () => {
  assert.equal(CairnLogic.splitAcceptanceCriteria("").description, "");
  assert.equal(CairnLogic.splitAcceptanceCriteria(null).description, "");
});
