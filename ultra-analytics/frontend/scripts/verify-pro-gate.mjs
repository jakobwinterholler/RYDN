/**
 * Viewport fit check for compact ProGate (Race Pass card).
 * Measures scrollHeight vs clientHeight — fails if overflow scroll is needed.
 * Also verifies dismiss controls remove the gate.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = join(__dirname, "../src/styles.css");
const fullCss = readFileSync(cssPath, "utf8");

const closeIcon = `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>`;

const markup = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>${fullCss}</style>
</head>
<body>
  <div id="gate-root" class="pro-gate-sheet sheet--fullscreen" style="position:fixed;inset:0;display:flex;flex-direction:column;overflow:hidden">
    <div class="sheet__panel--screen" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">
      <div class="pro-gate pro-gate--race">
        <div class="pro-gate__card">
          <div class="pro-gate__chrome">
            <button type="button" class="pro-gate__link pro-gate__link--muted">Redeem</button>
            <button type="button" class="pro-gate__dismiss" aria-label="Close">${closeIcon}</button>
          </div>
          <div class="pro-gate__mark" style="width:22px;height:22px;background:var(--accent);border-radius:2px"></div>
          <p class="pro-gate__eyebrow">One-time · no subscription</p>
          <h1 class="pro-gate__title">Race Pass</h1>
          <p class="pro-gate__price">4,99 €<span class="pro-gate__price-unit"> once</span></p>
          <p class="pro-gate__body">
            Unlock <strong>one</strong> planned GPX for a single race.
          </p>
          <ul class="pro-gate__perks">
            <li>
              <svg class="icon pro-gate__perk-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
              <span>Unlock one planned route</span>
            </li>
            <li>
              <svg class="icon pro-gate__perk-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
              <span>Full Pro planning on that course</span>
            </li>
            <li>
              <svg class="icon pro-gate__perk-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
              <span>One-time — no subscription</span>
            </li>
          </ul>
          <button type="button" class="btn btn--primary pro-gate__cta">Buy Race Pass · 4,99 €</button>
          <button type="button" class="pro-gate__account-link">Or get RYDN Pro in Account</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    function dismissGate() {
      document.getElementById("gate-root")?.remove();
    }
    document.querySelector(".pro-gate__dismiss")?.addEventListener("click", dismissGate);
  </script>
</body>
</html>
`;

const phoneViewports = [
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "iPhone SE short", width: 390, height: 667 },
  { name: "iPhone SE classic", width: 320, height: 568 },
  { name: "narrow short", width: 360, height: 640 },
];

const desktopMarkup = markup
  .replace(
    'id="gate-root" class="pro-gate-sheet sheet--fullscreen" style="position:fixed;inset:0;display:flex;flex-direction:column;overflow:hidden"',
    'id="gate-root" class="pro-gate-modal modal" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(26,26,24,0.36)"',
  )
  .replace(
    '<div class="sheet__panel--screen" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">',
    '<div class="modal__panel">',
  );

const browser = await chromium.launch();
let failed = false;

for (const vp of phoneViewports) {
  const page = await browser.newPage({ viewport: vp });
  await page.setContent(markup, { waitUntil: "load" });

  const metrics = await page.evaluate(() => {
    const gate = document.querySelector(".pro-gate");
    const card = document.querySelector(".pro-gate__card");
    const cta = document.querySelector(".pro-gate__cta");
    const account = document.querySelector(".pro-gate__account-link");
    const dismiss = document.querySelector(".pro-gate__dismiss");
    const notNow = document.querySelector(".pro-gate__not-now");
    const subButtons = Array.from(document.querySelectorAll("button")).filter((b) =>
      /subscribe|month|year/i.test(b.textContent || ""),
    );
    const perkChecks = document.querySelectorAll(".pro-gate__perk-check");
    const perks = Array.from(document.querySelectorAll(".pro-gate__perks li")).map((li) =>
      (li.textContent || "").trim(),
    );
    const gateStyle = getComputedStyle(gate);
    const cardStyle = getComputedStyle(card);
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.height > 0;
    };
    return {
      gateScrollH: gate.scrollHeight,
      gateClientH: gate.clientHeight,
      gateOverflowY: gateStyle.overflowY,
      cardScrollH: card.scrollHeight,
      cardClientH: card.clientHeight,
      cardFits: card.getBoundingClientRect().bottom <= window.innerHeight + 1,
      ctaVisible: visible(cta),
      accountVisible: visible(account),
      dismissVisible: visible(dismiss),
      hasNotNow: Boolean(notNow),
      hasSubscribeButtons: subButtons.length > 0,
      title: document.querySelector(".pro-gate__title")?.textContent?.trim(),
      perkCount: perks.length,
      perkCheckCount: perkChecks.length,
      perks,
      hasAccentBar: cardStyle.getPropertyValue("position") === "relative",
      ctaBg: getComputedStyle(cta).backgroundColor,
    };
  });

  const noScroll =
    metrics.gateScrollH <= metrics.gateClientH + 1 &&
    metrics.cardScrollH <= metrics.cardClientH + 1 &&
    metrics.gateOverflowY === "hidden";
  const ok =
    noScroll &&
    metrics.cardFits &&
    metrics.ctaVisible &&
    metrics.accountVisible &&
    metrics.dismissVisible &&
    !metrics.hasNotNow &&
    !metrics.hasSubscribeButtons &&
    metrics.title === "Race Pass" &&
    metrics.perkCount === 3 &&
    metrics.perkCheckCount === 3;

  console.log(
    `${ok ? "PASS" : "FAIL"} ${vp.name} ${vp.width}x${vp.height}`,
    JSON.stringify(metrics),
  );
  if (!ok) failed = true;
  await page.close();
}

// Desktop modal — centered card, not a stretched phone sheet
{
  const vp = { name: "Desktop", width: 1280, height: 800 };
  const page = await browser.newPage({ viewport: vp });
  await page.setContent(desktopMarkup, { waitUntil: "load" });
  const metrics = await page.evaluate(() => {
    const card = document.querySelector(".pro-gate__card");
    const panel = document.querySelector(".modal__panel");
    const r = card.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const cx = window.innerWidth / 2;
    return {
      cardW: Math.round(r.width),
      cardH: Math.round(r.height),
      panelW: Math.round(pr.width),
      centered: Math.abs(r.left + r.width / 2 - cx) < 24,
      notFullWidth: r.width < window.innerWidth * 0.55,
      notFullHeight: r.height < window.innerHeight * 0.92,
      title: document.querySelector(".pro-gate__title")?.textContent?.trim(),
    };
  });
  const ok =
    metrics.centered &&
    metrics.notFullWidth &&
    metrics.notFullHeight &&
    metrics.cardW <= 400 &&
    metrics.title === "Race Pass";
  console.log(`${ok ? "PASS" : "FAIL"} ${vp.name} ${vp.width}x${vp.height}`, JSON.stringify(metrics));
  if (!ok) failed = true;
  await page.screenshot({
    path: new URL("../test-results/progate-desktop.png", import.meta.url).pathname,
  });
  await page.close();
}

// Dismiss: X close removes gate
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(markup, { waitUntil: "load" });
  if ((await page.locator(".pro-gate").count()) !== 1) {
    console.error("FAIL dismiss setup — gate missing");
    failed = true;
  } else {
    await page.locator(".pro-gate__dismiss").click();
    const gone = (await page.locator(".pro-gate").count()) === 0;
    console.log(`${gone ? "PASS" : "FAIL"} dismiss via X`);
    if (!gone) failed = true;
  }
  await page.close();
}

await browser.close();
if (failed) {
  console.error("ProGate compact viewport verification failed");
  process.exit(1);
}
console.log("All viewports OK — no scroll overflow, Race Pass CTA visible, dismiss works");
