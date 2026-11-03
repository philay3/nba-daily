#!/usr/bin/env node
/**
 * Smoke test: visit every page and every studio template against a running app, fail on HTTP errors,
 * console errors, page errors or horizontal scroll at phone width, export one PNG per template and
 * check its pixel size.
 *
 *   BASE_URL=http://localhost:3000 npm run smoke
 *   SCREENSHOTS=1 DATE=2026-11-02 GAME_ID=401909906 npm run smoke   # also refresh docs/screenshots
 *
 * Uses the `playwright` package from the machine (not a project dependency):
 *   npm install -g playwright && npx playwright install chromium
 *   NODE_PATH="$(npm root -g)" npm run smoke
 */
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("playwright is not installed. Run: npm install -g playwright && npx playwright install chromium, then NODE_PATH=\"$(npm root -g)\" npm run smoke");
  process.exit(2);
}

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const DATE = process.env.DATE || "";
const SHOTS = process.env.SCREENSHOTS === "1";
const here = dirname(fileURLToPath(import.meta.url));
const shotDir = resolve(here, "..", "..", "docs", "screenshots");
const exportDir = process.env.EXPORT_DIR || mkdtempSync(join(tmpdir(), "nba-daily-exports-"));
if (SHOTS) mkdirSync(shotDir, { recursive: true });
mkdirSync(exportDir, { recursive: true });

const SIZES = { feed: [1080, 1350], story: [1080, 1920], youtube: [1920, 1080] };
const TEMPLATES = ["player", "matchup", "league", "recap"];
const withDate = (path) => (DATE ? `${path}${path.includes("?") ? "&" : "?"}date=${DATE}` : path);

const failures = [];
const passes = [];
const browser = await chromium.launch();

async function open(path, { width = 1440, height = 900, shot, fullPage = true, checkScroll = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const status = res?.status() ?? 0;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const label = `${path} @${width}`;
  if (status !== 200) failures.push(`${label}: HTTP ${status}`);
  if (errors.length) failures.push(`${label}: console errors: ${errors.join(" | ")}`);
  if (checkScroll && scrollWidth > width + 1) failures.push(`${label}: page scrolls sideways (${scrollWidth}px wide)`);
  if (status === 200 && !errors.length) passes.push(label);
  if (SHOTS && shot) await page.screenshot({ path: join(shotDir, shot), fullPage });
  return page;
}

// pages, discovering ids from the Today page
const today = await open(withDate("/"), { shot: "today-1440.png" });
const firstHref = async (page, prefix) => page.evaluate((p) => document.querySelector(`a[href^="${p}"]`)?.getAttribute("href") ?? null, prefix);
const gameHref = process.env.GAME_ID ? `/games/${process.env.GAME_ID}` : await firstHref(today, "/games/");
const playerHref = await firstHref(today, "/players/");
await today.close();
await (await open(withDate("/"), { width: 390, height: 844, shot: "today-390.png" })).close();
await (await open("/?date=2026-11-03")).close(); // Election Day: no games
await (await open("/?date=2026-11-03", { width: 390, height: 844 })).close();

if (gameHref) {
  await (await open(gameHref, { shot: "game-1440.png" })).close();
  await (await open(gameHref, { width: 390, height: 844, shot: "game-390.png" })).close();
} else {
  failures.push("no game link on the Today page");
}
for (const path of ["/teams", "/teams/LAL", "/players", playerHref, "/standings", "/injuries", "/injuries?show=out", "/studio"]) {
  if (!path) continue;
  await (await open(withDate(path))).close();
  await (await open(withDate(path), { width: 390, height: 844 })).close();
}
if (SHOTS) {
  await (await open(withDate("/teams"), { shot: "teams-1440.png" })).close();
  await (await open(withDate("/studio"), { shot: "studio-1440.png", fullPage: false })).close();
}

// a missing game must 404, not crash
{
  const page = await browser.newPage();
  const res = await page.goto(`${BASE}/games/1`, { waitUntil: "networkidle" });
  if (res?.status() !== 404) failures.push(`/games/1: expected 404, got ${res?.status()}`);
  else passes.push("/games/1 404");
  await page.close();
}

// every template at every size, full size
for (const t of TEMPLATES) {
  for (const [size, [w, h]] of Object.entries(SIZES)) {
    const page = await open(withDate(`/studio/frame?t=${t}&size=${size}`), { width: w, height: h, checkScroll: false, fullPage: false, shot: `studio-${t}-${size}.png` });
    const box = await page.locator("[data-frame]").boundingBox();
    if (!box || Math.round(box.width) !== w || Math.round(box.height) !== h) failures.push(`frame ${t} ${size}: ${box ? `${box.width}x${box.height}` : "missing"}`);
    await page.close();
  }
}

// one exported PNG per template, sizes rotated so all three get exercised
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
const exportPlan = [
  ["player", "feed"],
  ["matchup", "story"],
  ["league", "youtube"],
  ["recap", "feed"],
];
for (const [t, size] of exportPlan) {
  const page = await open(withDate(`/studio?t=${t}&size=${size}`), { checkScroll: false });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export PNG/ }).click()]);
  const file = join(exportDir, download.suggestedFilename());
  await download.saveAs(file);
  const [w, h] = pngSize(readFileSync(file));
  const [ew, eh] = SIZES[size];
  if (w !== ew || h !== eh) failures.push(`export ${t} ${size}: ${w}x${h}, expected ${ew}x${eh}`);
  else passes.push(`export ${t} ${size}: ${w}x${h} -> ${file}`);
  await page.close();
}

await browser.close();
for (const p of passes) console.log(`ok   ${p}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`\n${passes.length} passed, ${failures.length} failed${SHOTS ? `; screenshots in ${shotDir}` : ""}`);
process.exit(failures.length ? 1 : 0);
