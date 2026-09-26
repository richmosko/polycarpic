"use strict";

// POLY-56 gate-1 ruling (process/reviews/POLY-56/ruling.md § R1/R4):
// - cardEl: a DISTINCT `checklist` chip (`chip("checklist", "☑ " + done +
//   "/" + total)`), shown only when total > 0, fed by the server-stamped
//   `issue.checklist`. Never unified with the existing `subissues` chip
//   -- units differ (a sub-issue has its own status/owner; a checklist
//   row is a line of text), and collapsing them would let "3/3" hide a
//   sub-issue that isn't done.
// - renderDrawer: renders `issue.checklist_items` (server-stamped),
//   NEVER the deleted client-side `splitAcceptanceCriteria(...).items`
//   parse.
// - issueLinkListEl: a new `{checklist: true}` option (R4) -- the
//   Children list only -- prefixes each row with a disabled checkbox,
//   checked iff `status === "done"` (not "cancelled").
//
// board.js is DOM/render-flow code with no jsdom harness in this suite
// (see show-archived-client.test.js's own header) -- every test below is
// a source-text guard: read board.js as text, extract the specific
// function body via brace-matching, assert on presence/absence WITHIN
// the right function.
//
// Nothing under test exists yet -- every test below is expected to fail
// until implementation-lead's POLY-56 slice lands.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BOARD_JS_PATH = path.join(__dirname, "..", "..", "board", "board.js");

class ExtractionError extends Error {}

// Same brace-matching extractor as show-archived-client.test.js /
// record-drawer-client.test.js (duplicated, not imported -- this suite's
// existing convention for small, self-contained files).
function extractFunctionBody(source, functionName) {
  var match = source.match(new RegExp("function\\s+" + functionName + "\\s*\\([^)]*\\)\\s*\\{"));
  if (!match) {
    throw new ExtractionError(
      "could not find `function " + functionName + "(...) {` in board.js -- if this " +
        "function was renamed or restructured, this guard needs to be updated, not silenced."
    );
  }
  var start = match.index + match[0].length;
  var depth = 1;
  var i = start;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
  }
  if (depth !== 0) {
    throw new ExtractionError("unbalanced braces while extracting `" + functionName + "`'s body");
  }
  return source.slice(start, i - 1);
}

function readSource() {
  return fs.readFileSync(BOARD_JS_PATH, "utf8");
}

// ================= cardEl: checklist chip =================

test("cardEl renders a distinct checklist chip, not a reuse of the subissues class", () => {
  // Mutation: reuse the subissues class -- a checklist row and a
  // sub-issue are different units and must never share a chip class.
  const body = extractFunctionBody(readSource(), "cardEl");
  assert.match(
    body,
    /chip\(\s*"checklist"/,
    'expected a `chip("checklist", ...)` call inside cardEl'
  );
});

test("cardEl's checklist chip reads issue.checklist (server-stamped), not a client re-parse", () => {
  const body = extractFunctionBody(readSource(), "cardEl");
  assert.match(
    body,
    /issue\.checklist\b/,
    "cardEl must read issue.checklist -- the server-stamped {done, total}, not a client-side recount"
  );
});

test("cardEl's checklist chip is guarded by total > 0", () => {
  // Mutation: drop the total > 0 guard -- a checklist chip must not
  // render for an issue with no acceptance-criteria section at all.
  const body = extractFunctionBody(readSource(), "cardEl");
  const chipMatch = body.match(/if\s*\([^)]*\)\s*[^;{]*chip\(\s*"checklist"/);
  assert.ok(chipMatch, "expected the checklist chip call to be guarded by an `if (...)` condition");
  assert.match(
    chipMatch[0],
    /\.total\s*>\s*0/,
    "expected the guard to check `.total > 0` (mirrors the existing subissues chip's own guard)"
  );
});

// ================= renderDrawer: checklist_items =================

test("renderDrawer renders issue.checklist_items, not the deleted client-side items parse", () => {
  // Mutation: restore the client-side items parse -- splitAcceptanceCriteria
  // no longer produces an .items array (POLY-56 ruling), so renderDrawer
  // must read issue.checklist_items directly instead.
  const body = extractFunctionBody(readSource(), "renderDrawer");
  assert.match(
    body,
    /issue\.checklist_items\b/,
    "expected renderDrawer to reference issue.checklist_items"
  );
});

test("renderDrawer no longer reads split.items for the acceptance-criteria list", () => {
  const body = extractFunctionBody(readSource(), "renderDrawer");
  assert.doesNotMatch(
    body,
    /split\.items\b/,
    "renderDrawer must not read the deleted client-side split.items array anymore"
  );
});

// ================= issueLinkListEl: checklist-style child rows =================

test("issueLinkListEl accepts a checklist option that renders a checkbox per row", () => {
  const body = extractFunctionBody(readSource(), "issueLinkListEl");
  assert.match(
    body,
    /opts\.checklist\b/,
    "expected issueLinkListEl to branch on an opts.checklist flag (R4: Children list only)"
  );
  assert.match(
    body,
    /type\s*=\s*"checkbox"/,
    "expected a checkbox input to be created somewhere in issueLinkListEl"
  );
});

test("issueLinkListEl's child checkbox is checked iff status is done, not cancelled", () => {
  // Mutation: treat cancelled as checked -- only "done" may check the box.
  const body = extractFunctionBody(readSource(), "issueLinkListEl");
  const checkedMatch = body.match(/\.checked\s*=\s*[^;]+;/);
  assert.ok(checkedMatch, "expected a `.checked = ...` assignment inside issueLinkListEl");
  assert.match(checkedMatch[0], /===\s*"done"/, 'expected the checked assignment to compare against "done"');
  assert.doesNotMatch(
    checkedMatch[0],
    /cancelled/,
    "the checked assignment must not also treat cancelled as checked"
  );
});

test("renderDrawer's Children call site passes { checklist: true }, Blocked-by/Blocks do not", () => {
  const body = extractFunctionBody(readSource(), "renderDrawer");
  assert.match(
    body,
    /issueLinkListEl\(\s*kids\s*,\s*\{\s*checklist\s*:\s*true\s*\}\s*\)/,
    "expected the Children list's issueLinkListEl call to pass { checklist: true }"
  );
  // Sibling calls (Blocked by / Blocks) must be unaffected -- they still
  // pass their own existing options (markResolved, or nothing).
  assert.match(
    body,
    /issueLinkListEl\(\s*blockers\s*,\s*\{\s*markResolved:\s*true\s*\}\s*\)/,
    "expected the Blocked-by call site to be unchanged"
  );
});
