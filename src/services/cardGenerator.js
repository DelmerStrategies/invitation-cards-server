import puppeteer from "puppeteer";
import QRCode from "qrcode";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
import { TEMPLATE } from "../config/template.js";

const ASSETS_DIR = path.resolve("assets");

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Build @font-face rules with the bundled fonts embedded as data URIs, so
// rendering needs no internet (variable fonts cover all weights).
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
      // Font missing — fall back to system fonts for that family.
    }
  }
  return blocks.join("\n");
}

// Load + cache the HTML template (with fonts embedded) once per process.
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

function pad(n) {
  return String(n).padStart(2, "0");
}
// Convert Latin digits to Kurdish/Arabic-Indic numerals (٠-٩).
function ku(s) {
  const d = "٠١٢٣٤٥٦٧٨٩";
  return String(s).replace(/[0-9]/g, (n) => d[+n]);
}
function fmtDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d)) return "";
  return ku(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`);
}
function fmtTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d)) return "";
  const h24 = d.getHours();
  const period = h24 < 12 ? "پ.ن" : "د.ن"; // پێش نیوەڕۆ / دوای نیوەڕۆ
  const h12 = h24 % 12 || 12; // 0 -> 12
  return `${ku(h12)}:${ku(pad(d.getMinutes()))} ${period}`;
}

const DEFAULT_ORG = "مەکتەبی پەیوەندییەکانی یەکێتیی نیشتمانیی کوردستان و نەوەی نوێ";

function fillTemplate(html, guest, qrDataUri, event = {}) {
  const place = guest.address || event.venueAddress || "";
  const org = event.orgText != null && event.orgText !== "" ? event.orgText : DEFAULT_ORG;
  // Hide logos when the event has showLogo === false.
  const extraCss = event.showLogo === false ? ".logo{display:none !important}" : "";

  // Bottom-left block: separate date, time, location lines (each omitted if
  // not set, so there are no empty labels). RTL-aligned in the template CSS.
  const dateStr = fmtDate(event.date);
  const timeStr = fmtTime(event.date);
  const line = (label, val) =>
    val ? `<div><span class="k">${label}: </span><span class="v">${escapeHtml(val)}</span></div>` : "";
  const dateLine = line("بەروار", dateStr);
  const timeLine = line("کات", timeStr);
  const placeLine = line("شوێن", place);

  return html
    .replaceAll("{{GUEST_NAME}}", escapeHtml(guest.name))
    .replaceAll("{{QR_DATA_URI}}", qrDataUri)
    .replaceAll("{{ORG}}", escapeHtml(org))
    .replaceAll("{{EXTRA_CSS}}", extraCss)
    .replaceAll("{{DATE_LINE}}", dateLine)
    .replaceAll("{{TIME_LINE}}", timeLine)
    .replaceAll("{{PLACE_LINE}}", placeLine)
    .replaceAll("{{DATE}}", escapeHtml(dateStr))
    .replaceAll("{{TIME}}", escapeHtml(timeStr))
    .replaceAll("{{PLACE}}", escapeHtml(place));
}

// ── Persistent browser (launched once, reused across requests) ──
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage", // avoid /dev/shm exhaustion crashes on Linux/Docker
  "--disable-gpu",
];
let _browserPromise = null;

async function getBrowser() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      if (b.connected) return b;
    } catch {
      /* fall through and relaunch */
    }
    _browserPromise = null;
  }
  _browserPromise = puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  const browser = await _browserPromise;
  browser.on("disconnected", () => { _browserPromise = null; });
  return browser;
}

/** Pre-launch the browser at startup so the first download isn't slow. */
export async function warmupBrowser() {
  try { await getBrowser(); } catch (e) { console.error("[pdf] warmup failed:", e.message); }
}

/** Close the browser on shutdown. */
export async function closeBrowser() {
  if (!_browserPromise) return;
  try { (await _browserPromise).close(); } catch { /* ignore */ }
  _browserPromise = null;
}

// Run an async fn over items with a bounded number of concurrent workers,
// preserving input order in the results.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Render one guest's filled HTML to a PNG of just the card element. Also
// returns the QR image's rectangle (in output-image pixels, relative to the
// card's top-left) so callers can place a clickable link over it in the PDF.
async function renderCard(browser, html) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1000, height: 720, deviceScaleFactor: TEMPLATE.scale });
    // Fonts + QR are embedded as data URIs, so there are no external requests;
    // "load" settles quickly and won't hang on the network.
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });

    // In one round-trip: wait for embedded fonts, then measure the QR box.
    const qrCss = await page.evaluate(async (sel) => {
      if (document.fonts?.ready) await document.fonts.ready;
      const cardEl = document.querySelector(sel);
      const qrEl = cardEl && cardEl.querySelector('img[alt="QR"]');
      if (!cardEl) return { missing: true };
      if (!qrEl) return null;
      const c = cardEl.getBoundingClientRect();
      const q = qrEl.getBoundingClientRect();
      return { x: q.left - c.left, y: q.top - c.top, width: q.width, height: q.height };
    }, TEMPLATE.cardSelector);

    if (qrCss && qrCss.missing) {
      throw new Error(`Template is missing the ${TEMPLATE.cardSelector} element.`);
    }

    const card = await page.$(TEMPLATE.cardSelector);
    const png = await card.screenshot({ type: "png", optimizeForSpeed: true });

    // Scale CSS px -> output-image px (screenshot is at deviceScaleFactor).
    const s = TEMPLATE.scale;
    const qrRect = qrCss
      ? { x: qrCss.x * s, y: qrCss.y * s, width: qrCss.width * s, height: qrCss.height * s }
      : null;
    return { png, qrRect };
  } finally {
    await page.close();
  }
}

// Add an invisible clickable link over a rectangle on a PDF page. `rect` is in
// image pixels from the top-left; the page is the image at 1px = 1pt.
function addLink(pdf, page, url, rect, pageHeight) {
  const x1 = rect.x;
  const x2 = rect.x + rect.width;
  // PDF y-axis is bottom-up, so flip.
  const y1 = pageHeight - (rect.y + rect.height);
  const y2 = pageHeight - rect.y;
  const annot = pdf.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x1, y1, x2, y2],
    Border: [0, 0, 0], // no visible border
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  const ref = pdf.context.register(annot);
  const existing = page.node.Annots();
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), pdf.context.obj([ref]));
}

async function qrDataUri(url) {
  return QRCode.toDataURL(url, { margin: 1, errorCorrectionLevel: "M", width: 240 });
}

// Render every guest's card PNG concurrently (bounded), preserving order.
async function renderAll(guests, buildQrUrl, event) {
  const html = await loadHtml();
  const browser = await getBrowser();
  return mapLimit(guests, TEMPLATE.concurrency, async (guest) => {
    const url = buildQrUrl(guest);
    const filled = fillTemplate(html, guest, await qrDataUri(url), event);
    const { png, qrRect } = await renderCard(browser, filled);
    return { guest, url, png, qrRect };
  });
}

/** Generate a single card as a PNG buffer. */
export async function generateCardPng(guest, qrUrl, event = {}) {
  const html = await loadHtml();
  const filled = fillTemplate(html, guest, await qrDataUri(qrUrl), event);
  const { png } = await renderCard(await getBrowser(), filled);
  return png;
}

/** Generate one combined PDF with every guest's card, one per page. */
export async function generateBulkPdf(guests, buildQrUrl, event = {}) {
  const rendered = await renderAll(guests, buildQrUrl, event);
  const pdf = await PDFDocument.create();
  for (const { url, png, qrRect } of rendered) {
    const img = await pdf.embedPng(png);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    // Make the QR clickable: invisible link over its exact spot.
    if (qrRect) addLink(pdf, page, url, qrRect, img.height);
  }
  return Buffer.from(await pdf.save());
}

// Wrap one rendered card PNG into a single-page PDF (with the clickable QR).
async function pngToPdf(png, qrRect, url) {
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  if (qrRect) addLink(pdf, page, url, qrRect, img.height);
  return Buffer.from(await pdf.save());
}

/**
 * Generate a SEPARATE one-page PDF per guest. Returns an array of
 * { guest, pdf: Buffer }, in input order.
 */
export async function generatePerGuestPdfs(guests, buildQrUrl, event = {}) {
  const rendered = await renderAll(guests, buildQrUrl, event);
  return Promise.all(
    rendered.map(async ({ guest, url, png, qrRect }) => ({
      guest,
      pdf: await pngToPdf(png, qrRect, url),
    }))
  );
}
