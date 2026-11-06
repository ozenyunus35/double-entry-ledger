import { expect, test, type Page } from "@playwright/test";

// The demo books are built around "today"; pin it so dates, ids and the lock date are the same on every run.
const NOW = new Date("2026-11-06T10:00:00");

async function open(page: Page, query = "") {
  await page.clock.install({ time: NOW });
  await page.goto(`./${query}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

async function nav(page: Page, name: string) {
  if (isMobile(page)) await page.getByRole("button", { name: /Open menu|Menüyü aç/ }).click();
  await page.getByRole("navigation", { name: /Main|Ana menü/ }).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => {
    if (!/access control checks/.test(e.message)) throw e;
  });
});

test("opens on the demo company with checked books", async ({ page }) => {
  await open(page, "?lang=en");
  await expect(page.getByRole("heading", { level: 1, name: "Kuzey Studio" })).toBeVisible();
  await expect(page.getByText("Trial balance: debits equal credits", { exact: false })).toBeVisible();
  await expect(page.getByText("Balance sheet: assets equal liabilities plus equity")).toBeVisible();
  await expect(page.getByText("Cash flow statement ties to the change in cash")).toBeVisible();
  await expect(page.getByText("2 drafts waiting to be posted").first()).toBeVisible();
});

test("posts a balanced entry typed with Turkish number format, and refuses an unbalanced one", async ({ page }) => {
  await open(page, "?lang=en");
  await page.getByRole("button", { name: "New entry" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New journal entry" });
  await dialog.getByPlaceholder("What happened").fill("Printer toner");
  await dialog.getByLabel("Account for line 1").selectOption({ label: "6070 · Office and utilities" });
  await dialog.getByLabel("Debit for line 1").fill("1.250,50");
  await dialog.getByLabel("Account for line 2").selectOption({ label: "1000 · Cash on hand" });
  await dialog.getByLabel("Credit for line 2").fill("1.250,00");
  await expect(dialog.getByText("Out of balance by 0.50")).toBeVisible();
  await dialog.getByRole("button", { name: "Post entry" }).click();
  await expect(dialog.getByText("Debits and credits differ by 0.50")).toBeVisible();
  await dialog.getByLabel("Credit for line 2").fill("1.250,50");
  await expect(dialog.getByText("Balanced", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Post entry" }).click();
  await expect(page.getByText("Entry posted.")).toBeVisible();
  const panel = page.getByRole("dialog", { name: /#\d+/ }).or(page.locator("aside[role=dialog]"));
  await expect(panel.getByText("Printer toner")).toBeVisible();
  await expect(panel.getByText("1,250.50").first()).toBeVisible();
});

test("refuses to post into the locked period", async ({ page }) => {
  await open(page, "?lang=en");
  await page.getByRole("button", { name: "New entry" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New journal entry" });
  await dialog.getByLabel("Date").fill("2026-09-15");
  await dialog.getByLabel("Account for line 1").selectOption({ label: "6070 · Office and utilities" });
  await dialog.getByLabel("Debit for line 1").fill("100");
  await dialog.getByLabel("Account for line 2").selectOption({ label: "1000 · Cash on hand" });
  await dialog.getByLabel("Credit for line 2").fill("100");
  await expect(dialog.getByText("The period through 2026-09-30 is locked", { exact: false })).toBeVisible();
});

test("reverses a posted entry and links both ways", async ({ page }) => {
  await open(page, "?lang=en&v=journal&e=e-h9");
  const panel = page.locator("aside[role=dialog]");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Reverse" }).click();
  await panel.getByRole("button", { name: "Post reversal" }).click();
  await expect(page.getByText("Entry reversed.")).toBeVisible();
  await expect(page.locator("aside[role=dialog]").getByText(/Reverses #\d+/)).toBeVisible();
});

test("issues a euro invoice and records a payment with the exchange difference", async ({ page }) => {
  await open(page, "?lang=en&v=sales&d=new");
  const dialog = page.getByRole("dialog", { name: "New sales invoice" });
  await dialog.getByLabel("Customer").selectOption({ label: "Lumen & Ash Studio · DE" });
  await dialog.getByLabel("Price for line 1").fill("2000");
  await dialog.getByLabel("Description for line 1").fill("Icon set");
  await dialog.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByText(/Invoice KS-\d+ posted/)).toBeVisible();
  const panel = page.locator("aside[role=dialog]");
  await panel.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: /Record payment for/ });
  await pay.getByLabel("Rate on the payment day").fill("55");
  await pay.getByRole("button", { name: "Post payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  await expect(panel.getByText(/exchange gain/)).toBeVisible();
  await expect(panel.getByText("Paid", { exact: true })).toBeVisible();
});

test("imports the sample journal file", async ({ page }) => {
  await open(page, "?lang=en&v=import");
  await page.getByRole("button", { name: "Try the sample file" }).click();
  await expect(page.getByText("2 entries ready", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Post 2 entries" }).click();
  await expect(page.getByText("2 entries posted.")).toBeVisible();
});

test("explains a CSV it can't read", async ({ page }) => {
  await open(page, "?lang=en&v=import");
  await page.getByTestId("csv-input").setInputFiles({ name: "notes.csv", mimeType: "text/csv", buffer: Buffer.from("When;What\n1;2\n") });
  await expect(page.getByText("No date column was found")).toBeVisible();
  await page.getByTestId("csv-input").setInputFiles({ name: "books.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK\u0003\u0004") });
  await expect(page.getByText("isn't a CSV file")).toBeVisible();
});

test("every report ties out and the workbook downloads", async ({ page }) => {
  await open(page, "?lang=en&v=reports&r=tb");
  await expect(page.getByText("In balance: debits equal credits", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "Balance sheet" }).click();
  await expect(page.getByText("Balances", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Cash flow" }).click();
  await expect(page.getByText("Ties out", { exact: false })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel workbook" }).click();
  expect((await download).suggestedFilename()).toMatch(/kuzey-studio-.*\.xlsx$/);
});

test("finds an account from the command palette", async ({ page }) => {
  await open(page, "?lang=en");
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.keyboard.type("Bank EUR");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "General ledger" })).toBeVisible();
  await expect(page).toHaveURL(/a=1020/);
});

test("keeps the screen in the link", async ({ page }) => {
  await open(page, "?lang=en&v=ledger&a=1100");
  const account = page.getByRole("combobox", { name: "Account" });
  await expect(account).toHaveValue("1100");
  await page.reload();
  await expect(account).toHaveValue("1100");
  await expect(page.getByText("Opening balance on", { exact: false })).toBeVisible();
});

test("switches company and chart", async ({ page }) => {
  await open(page, "?lang=en");
  if (isMobile(page)) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: /Kuzey Studio/ }).first().click();
  await page.getByRole("menuitemradio", { name: /Turkish chart/ }).click();
  await nav(page, "Chart of accounts");
  await expect(page.getByText("Bankalar · TRY").or(page.getByText("Banks · TRY")).first()).toBeVisible();
  await expect(page.getByText("770.02").first()).toBeVisible();
});

test("works in Turkish on every screen", async ({ page }) => {
  await open(page, "?lang=tr");
  for (const name of ["Yevmiye", "Büyük defter", "Hesap planı", "Satış faturaları", "Alış faturaları", "Raporlar", "Dövizler", "Kapanış ve KDV", "İçe aktar", "Denetim izi"]) await nav(page, name);
  await page.goto("./?lang=tr&v=journal&e=e-h9");
  await expect(page.locator("aside[role=dialog]")).toBeVisible();
  const misses = await page.evaluate(() => [...((window as unknown as { __i18nMisses?: Set<string> }).__i18nMisses ?? [])]);
  expect(misses).toEqual([]);
});
