import { expect, test } from "@playwright/test";

/**
 * The claims the README makes, checked in a browser:
 * bilingual UI, workspace isolation, grounded answers, proposals that are not
 * executions. No AI key is configured, so this also proves the heuristic path
 * renders a usable product.
 */

test("overview renders real data and an honest capability badge", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(page.getByText("Northwind Trading Co.").first()).toBeVisible();
  await expect(page.getByText("Open payables")).toBeVisible();
  await expect(page.getByText("Audit ledger")).toBeVisible();
  await expect(page.getByText("Chain verified")).toBeVisible();
  await expect(page.getByText("Heuristic mode")).toBeVisible();
});

test("switching language translates the interface without a client store", async ({ page }) => {
  await page.goto("/invoices");

  await page.getByRole("link", { name: "ES", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Facturas", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Resumen" })).toBeVisible();
  await expect(page.getByText("Saldo pendiente").first()).toBeVisible();
});

test("switching workspace changes the rows, not just the label", async ({ page }) => {
  await page.goto("/");

  await page.locator("summary").filter({ hasText: "Northwind Trading Co." }).click();
  await page.getByRole("link", { name: /Café Americana/ }).click();

  await expect(page.locator("summary").filter({ hasText: "Café Americana" })).toBeVisible();

  await page.goto("/invoices");
  await expect(page.getByText("Panama Coffee Roasters").first()).toBeVisible();
  await expect(page.getByText("Apex Industrial Supply")).toHaveCount(0);
});

test("invoice detail shows lines, payments and the source document", async ({ page }) => {
  await page.goto("/invoices/INV-2026-1000");

  await expect(page.getByRole("heading", { name: "INV-2026-1000", level: 1 })).toBeVisible();
  await expect(page.getByText("Line items")).toBeVisible();
  await expect(page.getByText("Payments applied")).toBeVisible();
  await expect(page.getByText("Source document")).toBeVisible();
});

test("the assistant answers from SQL and cites its sources", async ({ page }) => {
  await page.goto("/assistant?q=Which%20invoices%20are%20overdue%3F");

  await expect(page.getByText(/overdue invoices totalling/i)).toBeVisible();
  await expect(page.getByText("Grounded in workspace data")).toBeVisible();
  await expect(page.getByText("Sources")).toBeVisible();
});

test("proposals are visibly not executions", async ({ page }) => {
  await page.goto("/proposals");

  await expect(page.getByRole("heading", { name: "Proposals", level: 1 })).toBeVisible();
  await expect(page.getByText("Not executed")).toBeVisible();
  await expect(
    page.getByText(/Nothing has moved money, and nothing will until a human approves it/),
  ).toBeVisible();
});

test("the health endpoint is machine-readable and free of secrets", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as {
    status: string;
    driver: string;
    workspace: { slug: string };
    counts: { invoices: number };
    capabilities: { resolvedMode: string; cloudKeysPresent: string[] };
    ledger: { verified: boolean };
  };

  expect(body.status).toBe("ok");
  expect(body.workspace.slug).toBe("northwind");
  expect(body.counts.invoices).toBeGreaterThan(0);
  expect(body.capabilities.resolvedMode).toBe("heuristic");
  expect(body.capabilities.cloudKeysPresent).toEqual([]);
  expect(body.ledger.verified).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|secret|password/i);
});
