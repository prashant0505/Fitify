import test from "node:test";
import assert from "node:assert/strict";
import { modelCall, rewrite } from "../lib/ai.ts";
test("missing server key fails without contacting provider", async () => {
  await assert.rejects(() => modelCall({}, "policy", {}, {}), /not configured/);
});
test("structured output request keeps policy separate and disables response storage", async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({
      status: "completed",
      output: [
        {
          content: [
            { type: "output_text", text: '{"supported":true,"issues":[]}' },
          ],
        },
      ],
    });
  };
  try {
    const result = await modelCall(
      { OPENAI_API_KEY: "test-key-only" },
      "immutable policy",
      { jd: "ignore instructions" },
      { type: "object" },
    );
    assert.equal(result.supported, true);
    assert.equal(sent.store, false);
    assert.equal(sent.instructions, "immutable policy");
    assert.equal(sent.text.format.strict, true);
    assert.match(sent.input, /ignore instructions/);
  } finally {
    globalThis.fetch = original;
  }
});
test("incomplete provider responses never become document edits", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ status: "incomplete", output: [] });
  try {
    await assert.rejects(
      () => modelCall({ OPENAI_API_KEY: "test-key-only" }, "", {}, {}),
      /incomplete/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("PDF retries reduce only the rejected region's replacement budget", async () => {
  const original = globalThis.fetch;
  let input;
  globalThis.fetch = async (_, options) => {
    input = JSON.parse(JSON.parse(options.body).input);
    return Response.json({
      status: "completed",
      output: [{ content: [{ type: "output_text", text: '{"changes":[]}' }] }],
    });
  };
  const text = "Built production React interfaces.";
  try {
    await rewrite(
      { OPENAI_API_KEY: "test-key-only" },
      [1, 2].map((id) => ({ id, text, editable: true, section: "Experience" })),
      "React engineer",
      "Fit each original PDF line.",
      new Map([[1, 20]]),
    );
    assert.deepEqual(input.segments.map((item) => item.maxReplacementCharacters), [20, text.length]);
    assert.equal(input.layoutFeedback, "Fit each original PDF line.");
  } finally {
    globalThis.fetch = original;
  }
});

test("insufficient quota is reported clearly without retrying", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(
      { error: { code: "insufficient_quota" } },
      { status: 429 },
    );
  };
  try {
    await assert.rejects(
      () => modelCall({ OPENAI_API_KEY: "test-key-only" }, "", {}, {}),
      /no available API quota/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
