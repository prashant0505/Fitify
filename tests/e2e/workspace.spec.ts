import { test, expect } from "@playwright/test";
import path from "node:path";
test.beforeEach(async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(
    page.getByRole("heading", {
      name: "Good experience deserves a great match.",
    }),
  ).toBeVisible();
});
test("dashboard, studio, real upload, persisted analysis and gated download", async ({
  page,
  request,
}) => {
  await page
    .getByRole("button", { name: "Tailor my resume", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Analyze my resume", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Upload resume")
    .setInputFiles(path.resolve("work/sample-resume.docx"));
  await page
    .getByRole("button", { name: "Try an example JD", exact: true })
    .click();
  await expect(page.getByText("DETECTED FROM YOUR DESCRIPTION")).toBeVisible();
  await page
    .getByRole("button", { name: "Analyze my resume", exact: true })
    .click();
  await expect(
    page.getByText("Analysis complete", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByText("Skills that connect", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("30", { exact: true })).toBeVisible();
  const config = await (await page.request.get("/api/config")).json();
  if (config.aiReady && config.documentReady)
    await expect(
      page.getByRole("button", { name: "Tailor my resume", exact: true }),
    ).toBeEnabled();
  else
    await expect(
      page.getByRole("button", { name: "Connect AI to start tailoring" }),
    ).toBeDisabled();
  await page
    .getByRole("tab", { name: "Document preview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A preview worth trusting." }),
  ).toBeVisible();
  const original = page.getByRole("link", {
    name: "Download untouched original",
  });
  const href = await original.getAttribute("href");
  const jobId = href!.split("/")[3];
  const cookie = (await page.context().cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const blocked = await request.get(`/api/jobs/${jobId}/download?type=docx`, {
    headers: { Cookie: cookie },
  });
  expect(blocked.status()).toBe(409);
  const download = await request.get(href!, { headers: { Cookie: cookie } });
  expect(download.ok()).toBeTruthy();
  expect((await download.body()).subarray(0, 2).toString()).toBe("PK");
  await page.reload();
  await page.getByRole("button", { name: /My resumes/ }).click();
  await expect(
    page.getByText("sample-resume.docx", { exact: false }).first(),
  ).toBeVisible();
  // Only the synthetic record created in this test is removed through the authenticated API.
  await request.delete(`/api/jobs/${jobId}`, { headers: { Cookie: cookie } });
});
test("invalid uploads fail visibly, example can be cleared, and mobile does not overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Compare the stable hero; saved resume counts legitimately change library height.
  await expect(page.locator(".hero")).toHaveScreenshot("mobile-hero.png", {
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Tailor my resume", exact: true })
    .click();
  await page.getByLabel("Upload resume").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a document"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose a PDF or DOCX");
  await page
    .getByRole("button", { name: "Try an example JD", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear job description", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Job description" }),
  ).toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("settings describe connection configuration and protect secrets", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("OpenAI rewriting", { exact: true }),
  ).toBeVisible();
  const config = await (await page.request.get("/api/config")).json();
  await expect(
    page
      .getByText(config.aiReady ? "Configured" : "Setup required", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("7 days", { exact: true })).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
});

test("PDF upload supports direct tailoring and offers no DOCX conversion", async ({
  page,
  request,
}) => {
  await page
    .getByRole("button", { name: "Tailor my resume", exact: true })
    .click();
  await page
    .getByLabel("Upload resume")
    .setInputFiles(path.resolve("work/sample-resume.pdf"));
  await page
    .getByRole("button", { name: "Try an example JD", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Analyze my resume", exact: true })
    .click();
  await expect(
    page.getByText("Analysis complete", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("PDF tailoring", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/editable PDF text regions? found/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "DOCX required for tailoring" }),
  ).toHaveCount(0);
  const config = await (await page.request.get("/api/config")).json();
  if (config.aiReady && config.documentReady)
    await expect(
      page.getByRole("button", { name: "Tailor my resume", exact: true }),
    ).toBeEnabled();
  const href = await page
    .getByRole("link", { name: "Download untouched original" })
    .getAttribute("href");
  const id = href!.split("/")[3];
  const cookie = (await page.context().cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const result = await request.get(`/api/jobs/${id}/download?type=docx`, {
    headers: { Cookie: cookie },
  });
  expect(result.status()).toBe(400);
  await page.screenshot({
    path: "outputs/fitify-pdf-analysis.png",
    fullPage: true,
  });
  await request.delete(`/api/jobs/${id}`, { headers: { Cookie: cookie } });
});

test("ready PDF supports highlighted and clean preview modes", async ({
  page,
}) => {
  const jobs = await (await page.request.get("/api/jobs")).json();
  const ready = jobs.find(
    (j: { status: string; format: string }) =>
      j.status === "ready" && j.format === "pdf",
  );
  test.skip(
    !ready,
    "A previously validated PDF is needed for this read-only preview smoke test.",
  );
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: /My resumes/ }).click();
  await page
    .locator(".resume-cell")
    .filter({ hasText: ready.name })
    .first()
    .click();
  await page
    .getByRole("tab", { name: "Document preview", exact: true })
    .click();
  const toggle = page.getByRole("button", {
    name: "Show changes",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('img[alt="Tailored document with changes highlighted"]'),
  ).toBeVisible();
  await expect(page.getByText(/updated region.*highlighted/)).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('img[alt="Tailored document with changes highlighted"]')
        .evaluate((image) => {
          const img = image as HTMLImageElement;
          return img.complete && img.naturalWidth > 0;
        }),
    )
    .toBe(true);
  await page
    .locator(".preview-card")
    .screenshot({ path: "outputs/fitify-highlight-preview.png" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('img[alt="Tailored document"]')).toBeVisible();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await toggle.click();
  await expect(
    page.locator('img[alt="Original document with changes highlighted"]'),
  ).toBeVisible();
});
