import { test, expect } from "@playwright/test";
const sizes = [320, 390, 768, 1024, 1280, 1440, 1920, 2560];
for (const width of sizes) {
  test(`workspace reflows without clipping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/signin-with-chatgpt?return_to=%2F");
    await expect(
      page.getByRole("heading", {
        name: "Good experience deserves a great match.",
      }),
    ).toBeVisible();
    const inspect = async () => {
      expect(
        await page.evaluate(() => ({
          width: window.innerWidth,
          scroll: document.documentElement.scrollWidth,
        })),
      ).toEqual({ width, scroll: width });
      expect(
        await page
          .locator("main")
          .evaluate(
            (el) => el.getBoundingClientRect().right <= window.innerWidth + 1,
          ),
      ).toBe(true);
    };
    await inspect();
    expect(
      await page.locator(".hero").evaluate((el) => {
        const outer = el.getBoundingClientRect();
        return [
          ...el.querySelectorAll(".floating-tag,.art-document,.art-caption"),
        ].every((child) => {
          const r = child.getBoundingClientRect();
          return (
            r.left >= outer.left &&
            r.right <= outer.right &&
            r.top >= outer.top &&
            r.bottom <= outer.bottom
          );
        });
      }),
    ).toBe(true);
    await page.screenshot({
      path: `outputs/fitify-dashboard-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Tailor my resume", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Job description" }),
    ).toBeVisible();
    await inspect();
    await expect(
      page.getByRole("button", { name: "Analyze my resume", exact: true }),
    ).toBeDisabled();
    if (width <= 1024)
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Built around your privacy." }),
    ).toBeVisible();
    await inspect();
  });
}
test("larger system text preserves readable controls and page reflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(
    page.getByRole("heading", {
      name: "Good experience deserves a great match.",
    }),
  ).toBeVisible();
  await page.addStyleTag({ content: ":root{font-size:20px}" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Tailor my resume", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "outputs/fitify-larger-text.png",
    fullPage: true,
  });
});
