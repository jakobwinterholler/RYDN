import { chromium } from "@playwright/test";

const base = process.env.OB_URL || "http://127.0.0.1:5181/onboarding-harness.html";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".onboarding__title", { timeout: 8000 });
console.log("step1", await page.locator(".onboarding__title").innerText());
await page.screenshot({ path: "test-results/onboarding-mobile-1.png" });

for (let i = 0; i < 5; i++) {
  const btn = page.getByRole("button", { name: /Continue|Open Library/ });
  await btn.first().click();
  await page.waitForTimeout(350);
  const title = await page.locator(".onboarding__title").innerText().catch(() => "(closed)");
  console.log(`after click ${i + 1}:`, title);
  await page.screenshot({ path: `test-results/onboarding-mobile-step-${i + 2}.png` });
}

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".onboarding__title");
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(300);
await page.screenshot({ path: "test-results/onboarding-desktop-1.png" });
for (let i = 0; i < 4; i++) {
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(300);
}
await page.screenshot({ path: "test-results/onboarding-desktop-plans.png" });

await browser.close();
console.log("done");
