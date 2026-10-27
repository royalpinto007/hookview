import { test, expect } from "@playwright/test";
test("fictional examples explain hooks and export decoded requirements", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Configured hook", exact: true })
    .click();
  await expect(page.getByTestId("hook-status")).toHaveText("Configured");
  await expect(page.locator("#source")).toHaveText("FICTIONAL EXAMPLE");
  await expect(page.locator(".account")).toHaveCount(2);
  await expect(
    page.getByText("PDA under the hook program", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("hookview-report.json");
  await page
    .getByRole("button", { name: "Disabled hook", exact: true })
    .click();
  await expect(page.getByTestId("hook-status")).toHaveText("Disabled");
  await expect(page.locator("#extra-status")).toHaveText("Not requested");
  await page.getByRole("button", { name: "No hook", exact: true }).click();
  await expect(page.getByTestId("hook-status")).toHaveText("No extension");
  await page.getByRole("button", { name: "Legacy mint", exact: true }).click();
  await expect(page.getByTestId("hook-status")).toHaveText("Legacy token");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("invalid input and RPC failures recover without stale exports", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Token mint address").fill("bad");
  await page.getByRole("button", { name: "Inspect mint", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("valid Solana mint");
  await expect(page.locator("#report")).toBeHidden();
  await page.route("**/api/inspect?**", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "RPC_RATE_LIMIT",
          message: "Public RPC rate limit reached. Wait a moment and retry.",
        },
      }),
    }),
  );
  await page
    .getByLabel("Token mint address")
    .fill("So11111111111111111111111111111111111111112");
  await page.getByRole("button", { name: "Inspect mint", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("rate limit");
  await page
    .getByRole("button", { name: "Configured hook", exact: true })
    .click();
  await expect(page.locator("#report")).toBeVisible();
  await page.getByLabel("Network", { exact: true }).selectOption("mainnet");
  await expect(page.locator("#report")).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Input changed");
});
test("live read UI displays the actual response source and discards slow prior results", async ({
  page,
  request,
}) => {
  const fixture = await (await request.get("/api/examples/configured")).json();
  fixture.source = "rpc";
  fixture.slot = 12345;
  fixture.network = "mainnet";
  delete fixture.exampleName;
  await page.route("**/api/inspect?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Token mint address").fill(fixture.mint);
  await page.getByRole("button", { name: "Inspect mint", exact: true }).click();
  await expect(page.locator("#source")).toHaveText("CONFIRMED RPC READ");
  await expect(page.locator("#observation")).toContainText("12345");
  await page.getByLabel("Token mint address").fill("bad");
  await expect(page.locator("#report")).toBeHidden();
});
