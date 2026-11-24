import test from "node:test";
import assert from "node:assert/strict";
import { analyze, contains, tailoredCoverage, validateChanges } from "../lib/analysis.ts";
import { assessAlignment, jobRequirements, retainAlignedChanges } from "../lib/requirements.ts";
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
test("job terminology recognizes equivalent skill names", () => {
  const result = analyze("Worked with Amazon Web Services, Postgres and SpringBoot.", "AWS, PostgreSQL and Spring are required.");
  assert.deepEqual(result.matched, ["Spring", "PostgreSQL", "AWS"]);
  assert.equal(result.score, 100);
});
test("confirmed technology can be added only to the targeted experience bullet", () => {
  const source = { ...segment, text: "Built messaging infrastructure and maintained uptime." };
  const another = { ...source, id: 2 };
  const change = { ...edit, original: source.text, replacement: "Built RabbitMQ infrastructure and maintained uptime.", evidence: source.text };
  const facts = [{ term: "RabbitMQ", detail: "Used RabbitMQ for event queues.", targetId: source.id }];
  assert.doesNotThrow(() => validateChanges([source, another], [change], facts));
  assert.throws(() => validateChanges([source, another], [{ ...change, id: 2 }], facts), /RabbitMQ/);
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
test("skills can surface original experience without attributing it to another role", () => {
  const list = { id: 2, section: "Skills", text: "TypeScript, Git", editable: true };
  const change = { ...edit, id: 2, original: list.text, evidence: list.text, replacement: "React, TypeScript, Git" };
  assert.doesNotThrow(() => validateChanges([segment, list], [change]));
  assert.throws(() => validateChanges([list], [change]), /React/);
  assert.throws(() => validateChanges([segment, list], [{
    ...edit, replacement: original.replace("React", "TypeScript"),
  }]), /TypeScript/);
});
test("tailored coverage uses replacements and unchanged text", () => {
  const coverage = tailoredCoverage(["React", "Testing", "Docker"], [segment], [{
    ...edit, replacement: original.replace("testing", "verification"),
  }]);
  assert.deepEqual(coverage, { matched: ["React"], missing: ["Testing", "Docker"], score: 33 });
});
test("requirement coverage weights must-haves and counts messaging alternatives once", () => {
  const requirements = jobRequirements(
    "Required: Java; messaging systems like Kafka, RabbitMQ.\nPreferred: Docker.",
    ["Java", "Kafka", "RabbitMQ", "Docker"],
  );
  const fit = assessAlignment(requirements, [{ ...segment, text: "Built Java and RabbitMQ services." }]);
  assert.equal(fit.items.length, 3);
  assert.equal(fit.score, 86);
  assert.deepEqual(fit.gaps.map((gap) => gap.terms), [["Docker"]]);
});
test("tailoring keeps existing must-have evidence when other edits are filtered", () => {
  const source = { ...segment, text: "Built React interfaces." };
  const other = { ...segment, id: 2, text: "Maintained customer workflows." };
  const requirements = jobRequirements("React is required.\nTesting preferred.", ["React", "Testing"]);
  const removeReact = { ...edit, original: source.text, replacement: "Built customer interfaces." };
  const addTesting = { ...edit, id: 2, original: other.text, replacement: "Tested customer workflows with automated testing." };
  assert.deepEqual(retainAlignedChanges(requirements, [source, other], [removeReact, addTesting]), [addTesting]);
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
