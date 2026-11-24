import test from "node:test";
import assert from "node:assert/strict";
import { analyze, contains, validateChanges } from "../lib/analysis.ts";
test("keyword coverage uses word boundaries and explicitly labels its limits", () => {
  assert.equal(contains("Django", "Go"), false);
  const a = analyze(
    "Built React interfaces with TypeScript.",
    "Senior engineer using React, TypeScript, AWS and SQL with 4 years of experience.",
  );
  assert.deepEqual(a.matched, ["TypeScript", "React"]);
  assert.equal(a.score, 50);
  assert.ok(a.missing.includes("AWS"));
  assert.match(a.method, /not an ATS/);
});
test("empty recognized terms does not invent alignment", () => {
  assert.equal(analyze("Resume", "We need a wonderful person").score, 0);
});
const original =
  "Built accessible React interfaces and automated workflows to reduce manual testing time by 20%.";
const segment = {
  id: 1,
  text: original,
  editable: true,
  section: "Experience",
};
const edit = {
  id: 1,
  original,
  replacement: original.replace("accessible", "responsive"),
  reason: "Clarity",
  evidence: "Built accessible React interfaces",
};
test("supported same-size edits pass deterministic checks", () => {
  assert.doesNotThrow(() => validateChanges([segment], [edit]));
});
test("invented metrics are rejected", () => {
  assert.throws(
    () =>
      validateChanges(
        [segment],
        [{ ...edit, replacement: original.replace("20%", "50%") }],
      ),
    /numerical/,
  );
});
test("invented technologies are rejected", () => {
  assert.throws(
    () =>
      validateChanges(
        [segment],
        [{ ...edit, replacement: original.replace("React", "Vue") }],
      ),
    /Vue/,
  );
});
test("protected fields, missing evidence and duplicate edits are rejected", () => {
  assert.throws(() =>
    validateChanges([{ ...segment, editable: false }], [edit]),
  );
  assert.throws(() =>
    validateChanges([segment], [{ ...edit, evidence: "not in resume" }]),
  );
  assert.throws(() => validateChanges([segment], [edit, edit]));
});
