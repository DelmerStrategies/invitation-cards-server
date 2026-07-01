import archiver from "archiver";
import { Writable } from "node:stream";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colLetter = (i) => {
  let s = "";
  i++;
  while (i > 0) { s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

/**
 * Build a minimal .xlsx (inline strings, one sheet) into a Buffer.
 * rows: array of arrays of cell values (strings). First row = header.
 */
export function buildXlsxBuffer(rows, { sheetName = "Sheet1", widths = [], rtl = true } = {}) {
  const sheetRows = rows
    .map((cells, ri) =>
      `<row r="${ri + 1}">` +
      cells.map((v, ci) => `<c r="${colLetter(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join("") +
      `</row>`
    )
    .join("");
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}"/>`).join("")}</cols>` : "";
  const views = rtl ? `<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>` : "";
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}${cols}<sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
    const zip = archiver("zip", { zlib: { level: 9 } });
    zip.on("error", reject);
    sink.on("finish", () => resolve(Buffer.concat(chunks)));
    zip.pipe(sink);
    zip.append(ct, { name: "[Content_Types].xml" });
    zip.append(rels, { name: "_rels/.rels" });
    zip.append(workbook, { name: "xl/workbook.xml" });
    zip.append(wbRels, { name: "xl/_rels/workbook.xml.rels" });
    zip.append(sheet, { name: "xl/worksheets/sheet1.xml" });
    zip.finalize();
  });
}
