import puppeteer from "puppeteer";
import QRCode from "qrcode";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
import { TEMPLATE } from "../config/template.js";

const ASSETS_DIR = path.resolve("assets");
const DEFAULT_ORG = "مەکتەبی پەیوەندییەکانی یەکێتیی نیشتمانیی کوردستان و نەوەی نوێ";

// ── fonts: embedded as data URIs so rendering needs no internet ──
async function buildFontCss() {
  const dir = path.join(ASSETS_DIR, "fonts");
  const fonts = [
    { family: "Noto Kufi Arabic", file: "NotoKufiArabic.woff2" },
    { family: "Noto Naskh Arabic", file: "NotoNaskhArabic.woff2" },
  ];
  const blocks = [];
  for (const f of fonts) {
    try {
      const b64 = (await fs.readFile(path.join(dir, f.file))).toString("base64");
      blocks.push(
        `@font-face{font-family:'${f.family}';font-style:normal;font-weight:100 900;` +
          `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
      );
    } catch {
      /* font missing — fall back to system fonts */
    }
  }
  return blocks.join("\n");
}

// Load + cache the template (with fonts embedded) once per process.
let _html = null;
async function loadHtml() {
  if (_html) return _html;
  let html;
  try {
    html = await fs.readFile(path.join(ASSETS_DIR, TEMPLATE.file), "utf8");
  } catch {
    throw new Error(
      `Static template not found at server/assets/${TEMPLATE.file}. Add your design there.`
    );
  }
  const fontCss = await buildFontCss();
  html = html.includes("</head>")
    ? html.replace("</head>", `<style>${fontCss}</style></head>`)
    : `<style>${fontCss}</style>${html}`;
  _html = html;
  return _html;
}

const pad = (n) => String(n).padStart(2, "0");
const ku = (s) => String(s).replace(/[0-9]/g, (n) => "٠١٢٣٤٥٦٧٨٩"[+n]); // Kurdish digits
function fmtDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d) ? "" : ku(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`);
}
function fmtTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d)) return "";
  const period = d.getHours() < 12 ? "پ.ن" : "د.ن";
  const h12 = d.getHours() % 12 || 12;
  return `${ku(h12)}:${ku(pad(d.getMinutes()))} ${period}`;
}

// Body text -> an array of paragraphs (one per non-empty line).
function bodyParas(event = {}) {
  return String(event.bodyText || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Per-event values that are constant across a whole batch.
function eventConsts(event = {}) {
  return {
    org: event.orgText != null && event.orgText !== "" ? event.orgText : DEFAULT_ORG,
    date: fmtDate(event.date),
    time: fmtTime(event.date),
    hideLogo: event.showLogo === false,
    // Empty array => leave the template's built-in body wording untouched.
    body: bodyParas(event),
  };
}

// ── persistent browser ──
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];
let _browserPromise = null;

async function getBrowser() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      if (b.connected) return b;
    } catch {
      /* relaunch */
    }
    _browserPromise = null;
  }
  _browserPromise = puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  const browser = await _browserPromise;
  browser.on("disconnected", () => { _browserPromise = null; });
  return browser;
}

export async function warmupBrowser() {
  try { await getBrowser(); } catch (e) { console.error("[pdf] warmup failed:", e.message); }
}
export async function closeBrowser() {
  if (!_browserPromise) return;
  try { (await _browserPromise).close(); } catch { /* ignore */ }
  _browserPromise = null;
}

// Create a page in its OWN browser context, load the template once, and set the
// per-event constants. Separate contexts let screenshots run concurrently
// without the headless single-browser screenshot deadlock.
async function initPage(browser, html, consts) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1000, height: 720, deviceScaleFactor: TEMPLATE.scale });
  await page.setContent(html, { waitUntil: "load", timeout: 20000 });
  await page.evaluate(async (ev) => {
    if (document.fonts?.ready) await document.fonts.ready;
    // Org text shows only in the bottom footer now (top header kept logos only).
    const orgFoot = document.getElementById("orgfoot");
    if (orgFoot) orgFoot.textContent = ev.org;
    if (ev.hideLogo) document.querySelectorAll(".logo").forEach((l) => (l.style.display = "none"));
    // Editable invitation body (one <p> per line). Empty => keep template text.
    if (ev.body && ev.body.length) {
      const bt = document.getElementById("bodytext");
      if (bt) {
        bt.textContent = "";
        for (const para of ev.body) {
          const p = document.createElement("p");
          p.textContent = para;
          bt.appendChild(p);
        }
      }
    }
    const line = (id, label, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = "";
      if (!value) return;
      const k = document.createElement("span"); k.className = "k"; k.textContent = label + ": ";
      const v = document.createElement("span"); v.className = "v"; v.textContent = value;
      el.append(k, v);
    };
    line("dateline", "بەروار", ev.date);
    line("timeline", "کات", ev.time);
  }, consts);
  return page;
}

// QR rectangle in output-image pixels (layout is identical for every card).
async function measureQrRect(page) {
  const css = await page.evaluate((sel) => {
    const c = document.querySelector(sel);
    const q = c && c.querySelector("#qrimg");
    if (!q) return null;
    const cb = c.getBoundingClientRect();
    const qb = q.getBoundingClientRect();
    return { x: qb.left - cb.left, y: qb.top - cb.top, width: qb.width, height: qb.height };
  }, TEMPLATE.cardSelector);
  if (!css) return null;
  const s = TEMPLATE.scale;
  return { x: css.x * s, y: css.y * s, width: css.width * s, height: css.height * s };
}

// Update only the per-guest fields on an already-loaded page.
// `hideQr` (VIP guests) hides the whole QR corner so the card has no code.
async function renderGuest(page, name, qrDataUri, place, hideQr) {
  await page.evaluate(async (d) => {
    const g = document.getElementById("gname");
    if (g) g.textContent = d.name;
    const corner = document.querySelector(".qr-corner");
    const q = document.getElementById("qrimg");
    if (d.hideQr) {
      if (corner) corner.style.display = "none";
    } else {
      if (corner) corner.style.display = "";
      if (q) {
        q.src = d.qr;
        // Cap decode so a stuck image can't hang the whole render.
        try { await Promise.race([q.decode(), new Promise((r) => setTimeout(r, 2000))]); } catch { /* ignore */ }
      }
    }
    const el = document.getElementById("placeline");
    if (el) {
      el.textContent = "";
      if (d.place) {
        const k = document.createElement("span"); k.className = "k"; k.textContent = "شوێن: ";
        const v = document.createElement("span"); v.className = "v"; v.textContent = d.place;
        el.append(k, v);
      }
    }
  }, { name, qr: qrDataUri, place, hideQr: !!hideQr });
}

function addLink(pdf, page, url, rect, pageHeight) {
  const annot = pdf.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [rect.x, pageHeight - (rect.y + rect.height), rect.x + rect.width, pageHeight - rect.y],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  const ref = pdf.context.register(annot);
  const existing = page.node.Annots();
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), pdf.context.obj([ref]));
}

function qrDataUri(url) {
  return QRCode.toDataURL(url, { margin: 1, errorCorrectionLevel: "M", width: 240 });
}

// Reject if `promise` doesn't settle within `ms` (so one stuck card can't hang
// the whole export).
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
const CARD_TIMEOUT_MS = 30000;

// Render guests ONE AT A TIME on a single reused page, calling onCard(card, i)
// for each. Memory-frugal: only one card's PNG is alive at a time, so big
// batches don't blow the RAM cap on small instances — the caller consumes each
// card (e.g. appends it straight to a zip) before the next is rendered.
// `onProgress(done)` fires after each card; a failed/stalled card is skipped and
// its page rebuilt, so the batch always finishes.
async function renderEach(guests, buildQrUrl, event = {}, onCard, onProgress) {
  if (!guests.length) return;
  const html = await loadHtml();
  const consts = eventConsts(event);
  const browser = await getBrowser();
  let page = await initPage(browser, html, consts);
  let card = await page.$(TEMPLATE.cardSelector);
  let done = 0;
  try {
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i];
      // VIP cards get no QR code and no clickable link.
      const isVip = !!g.isVip;
      const url = isVip ? null : buildQrUrl(g);
      const place = g.address || event.venueAddress || "";
      try {
        const png = await withTimeout(
          (async () => {
            const qr = isVip ? null : await qrDataUri(url);
            await renderGuest(page, g.name, qr, place, isVip);
            return card.screenshot({ type: "png", optimizeForSpeed: true });
          })(),
          CARD_TIMEOUT_MS,
          `card ${i} (${g.name})`
        );
        await onCard({ guest: g, url, png, isVip }, i);
      } catch (err) {
        console.error(`[pdf] skipped card ${i} (${g.name}): ${err.message}`);
        // The page may be poisoned — rebuild it for the remaining cards.
        try { await page.browserContext().close(); } catch { /* ignore */ }
        page = await initPage(browser, html, consts);
        card = await page.$(TEMPLATE.cardSelector);
      }
      if (onProgress) onProgress(++done);
    }
  } finally {
    try { await page.browserContext().close(); } catch { /* ignore */ }
  }
}

/** Generate a single card as a PNG buffer. */
export async function generateCardPng(guest, qrUrl, event = {}) {
  let out = null;
  await renderEach([guest], () => qrUrl, event, ({ png }) => { out = png; });
  if (!out) throw new Error("Card render failed.");
  return out;
}

/** Generate one combined PDF with every guest's card, one per page. */
export async function generateBulkPdf(guests, buildQrUrl, event = {}, onProgress) {
  const pdf = await PDFDocument.create();
  await renderEach(
    guests,
    buildQrUrl,
    event,
    async ({ url, png, isVip }) => {
      const img = await pdf.embedPng(png);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      // Whole page is clickable → opens the guest's RSVP link (skipped for VIP).
      if (!isVip && url) {
        addLink(pdf, page, url, { x: 0, y: 0, width: img.width, height: img.height }, img.height);
      }
    },
    onProgress
  );
  return Buffer.from(await pdf.save());
}

// Wrap one rendered card PNG into a single-page PDF. The whole page is a
// clickable link to the guest's RSVP URL — unless `url` is null (VIP cards).
async function pngToPdf(png, url) {
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  if (url) addLink(pdf, page, url, { x: 0, y: 0, width: img.width, height: img.height }, img.height);
  return Buffer.from(await pdf.save());
}

/**
 * Stream a SEPARATE one-page PDF per guest. `onPdf(guest, pdfBuffer, index)` is
 * called for each card as it's produced (e.g. to append it to a zip), so we
 * never hold all cards in memory at once.
 */
export async function streamPerGuestPdfs(guests, buildQrUrl, event = {}, onProgress, onPdf) {
  let n = 0;
  await renderEach(
    guests,
    buildQrUrl,
    event,
    async ({ guest, url, png, isVip }) => {
      const pdf = await pngToPdf(png, isVip ? null : url);
      await onPdf(guest, pdf, n++);
    },
    onProgress
  );
}
