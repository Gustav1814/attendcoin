// Drives the seeded local stack through a check-in, a redemption and a
// fulfilment, and captures the screenshots in docs/screenshots/.
//
// Needs the node, backend and frontend from the README quickstart running, with
// the frontend started with VITE_DEV_WALLETS=true, and a fresh seed: the
// teacher's QR comes from the live session the seed leaves open.
//
// puppeteer-core is not a project dependency. Install it anywhere and point
// SHOTS_MODULES at that node_modules folder:
//
//   npm install --prefix /tmp/shots puppeteer-core@23 jsqr pngjs
//   SHOTS_MODULES=/tmp/shots/node_modules node scripts/screenshots.mjs
//
// jsqr and pngjs are optional. With them the student follows the link decoded
// from the QR on the teacher's screen; without them the link is signed here
// with the seed's session key.
//
// Env: BASE_URL (http://localhost:5173), CHROME_PATH (/usr/bin/google-chrome).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Wallet } from "ethers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "screenshots");
const BASE = (process.env.BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

const ACCOUNTS = { admin: 0, teacher: 1, vendor: 3, student: 6 };
const STORE_ITEM = "Cafeteria";
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function load(name) {
  const dir = process.env.SHOTS_MODULES;
  const require = createRequire(dir ? path.join(path.resolve(dir), "noop.js") : import.meta.url);
  const mod = await import(pathToFileURL(require.resolve(name)).href);
  return mod.default ?? mod;
}

async function optional(name) {
  try {
    return await load(name);
  } catch {
    return null;
  }
}

const puppeteer = await load("puppeteer-core").catch(() => {
  console.error("puppeteer-core not found. Install it and set SHOTS_MODULES (see the top of this file).");
  process.exit(1);
});
const jsQR = await optional("jsqr");
const pngjs = await optional("pngjs");

const seedFile = path.join(root, "deployments", "localhost.seed.json");
const deploymentFile = path.join(root, "deployments", "localhost.json");
const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
const live = seed.liveSession;
if (!live) throw new Error(`${seedFile} has no liveSession. Reseed the chain.`);

fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const problems = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--font-render-hinting=none"],
});

async function open(label, account, viewport = DESKTOP) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  page.on("console", (msg) => {
    // qr-scanner warns that the camera needs https; there is no camera here anyway.
    if (msg.type() === "error" || (msg.type() === "warn" && !msg.text().includes("https"))) {
      problems.push(`[${label}] console.${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => problems.push(`[${label}] ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400) problems.push(`[${label}] HTTP ${res.status()} ${res.url()}`);
  });
  await page.evaluateOnNewDocument(
    (wallet, session) => {
      if (wallet) localStorage.setItem("attendcoin.wallet", wallet);
      if (session) sessionStorage.setItem(`attendcoin.session-key.${session.id}`, session.key);
    },
    account == null ? null : `dev:${account}`,
    account === ACCOUNTS.teacher ? { id: String(live.sessionId), key: live.signerPrivateKey } : null,
  );
  return page;
}

// Waits for queries to settle and loading skeletons to go before a capture.
async function settle(page) {
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 15_000 }).catch(() => {});
  await page
    .waitForFunction(() => !document.querySelector('[class*="skeleton"], [aria-busy="true"]'), { timeout: 15_000 })
    .catch(() => problems.push(`[${page.url()}] still loading when captured`));
  await sleep(400);
}

async function visit(page, route) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await settle(page);
}

async function shoot(page, name, { fullPage = true } = {}) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: path.join(outDir, name), fullPage });
  console.log(`  ${name}`);
}

const waitForText = (page, text, timeout = 30_000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

async function checkinLink(teacher) {
  const stage = await teacher.waitForSelector('section[aria-label="Check-in code"] [role="img"] svg', { timeout: 20_000 });
  if (jsQR && pngjs) {
    const tile = await stage.evaluateHandle((el) => el.closest('[role="img"]'));
    const png = pngjs.PNG.sync.read(Buffer.from(await tile.screenshot()));
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    if (!code) throw new Error("The QR on the teacher's screen did not decode");
    return code.data.replace(/^https?:\/\/[^/]+/, BASE);
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const domain = {
    name: "AttendCoin Attendance",
    version: "1",
    chainId: deployment.chainId,
    verifyingContract: deployment.contracts.AttendanceManager,
  };
  const types = { Ticket: [{ name: "sessionId", type: "uint256" }, { name: "issuedAt", type: "uint64" }] };
  const sig = await new Wallet(live.signerPrivateKey).signTypedData(domain, types, { sessionId: live.sessionId, issuedAt });
  return `${BASE}/checkin?${new URLSearchParams({ s: String(live.sessionId), t: String(issuedAt), sig })}`;
}

try {
  console.log(`Capturing ${BASE} into ${path.relative(root, outDir)}/`);

  const visitor = await open("visitor", null);
  await visit(visitor, "/");
  await shoot(visitor, "01-landing.png");

  // Teacher puts the live session on screen; the student follows its link on a phone.
  const teacher = await open("teacher", ACCOUNTS.teacher);
  await visit(teacher, `/teacher/sessions/${live.sessionId}`);
  const link = await checkinLink(teacher);

  const phone = await open("student phone", ACCOUNTS.student, PHONE);
  await phone.goto(link, { waitUntil: "domcontentloaded" });
  await settle(phone);
  const signButton = await phone.$("button::-p-text(Sign and check in)");
  await shoot(phone, "03-student-checkin-mobile.png", { fullPage: false });
  if (signButton) {
    await signButton.click();
    await waitForText(teacher, "Submit 1 check-in");
    await settle(teacher);
    await shoot(teacher, "07-teacher-live-session.png");
    await teacher.locator("button::-p-text(Submit 1 check-in)").click();
    await waitForText(phone, "checked in", 60_000).catch(() => problems.push("student page never showed the check-in as recorded"));
  } else {
    console.log("  (student already checked in to this session; rerun after a fresh seed for the full flow)");
    await shoot(teacher, "07-teacher-live-session.png");
  }

  await visit(teacher, "/teacher");
  await shoot(teacher, "06-teacher-courses.png");
  await visit(teacher, `/teacher/courses/${live.courseId}`);
  await shoot(teacher, "08-teacher-report.png");

  const student = await open("student", ACCOUNTS.student);
  await visit(student, "/student");
  await shoot(student, "02-student-overview.png");
  await visit(student, "/student/store");
  await shoot(student, "04-student-store.png");

  await student.locator(`button[aria-label^="Redeem ${STORE_ITEM}"]`).click();
  await student.locator("button::-p-text(Redeem for)").click();
  await waitForText(student, "Show code", 60_000);
  await visit(student, "/student/redemptions");
  await shoot(student, "05-student-redemptions.png");
  const redemptionId = (await student.evaluate(() => document.body.innerText)).match(/#(\d+)/)?.[1];
  if (!redemptionId) throw new Error("No redemption id on the student's redemptions page");

  const vendor = await open("vendor", ACCOUNTS.vendor);
  await visit(vendor, "/vendor");
  await vendor.locator("form input").fill(redemptionId);
  await vendor.locator("button::-p-text(Look up)").click();
  await vendor.waitForSelector(`button[aria-label^="Fulfil"], button::-p-text(Fulfil)`);
  await settle(vendor);
  await shoot(vendor, "12-vendor-counter.png");
  await vendor.locator("button::-p-text(Fulfil)").click();
  await waitForText(vendor, "Hand over", 60_000).catch(() => problems.push(`vendor never confirmed redemption #${redemptionId}`));

  const admin = await open("admin", ACCOUNTS.admin);
  await visit(admin, "/admin");
  await shoot(admin, "09-admin-overview.png");
  await visit(admin, "/admin/people");
  await shoot(admin, "10-admin-people.png");
  await visit(admin, "/admin/economy");
  await shoot(admin, "11-admin-economy.png");

  const mobile = await open("student mobile", ACCOUNTS.student, PHONE);
  await visit(mobile, "/student");
  await shoot(mobile, "13-student-overview-mobile.png", { fullPage: false });
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) seen in the browser:`);
  for (const p of problems) console.log(`  ${p}`);
  process.exitCode = 1;
}
