const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const archiver = require("archiver");
const { parse: csvParse } = require("csv-parse/sync");
const { Readable, PassThrough } = require("stream");

/**
 * Extract all unique {field} placeholders from a .docx buffer.
 * @param {Buffer} docxBuffer
 * @returns {string[]} - Array of unique field names
 */
function extractFields(docxBuffer) {
  const zip = new PizZip(docxBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });

  // Get all tags from the document
  const tags = doc.getFullText ? [] : [];

  // Manual extraction via regex on raw XML for reliability
  const content = zip.file("word/document.xml").asText();
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  const fields = new Set();
  let match;
  while ((match = regex.exec(content)) !== null) {
    fields.add(match[1]);
  }

  // Also check headers and footers
  const headerFooterFiles = Object.keys(zip.files).filter(
    (name) =>
      name.startsWith("word/header") || name.startsWith("word/footer")
  );
  for (const hfFile of headerFooterFiles) {
    const hfContent = zip.file(hfFile).asText();
    while ((match = regex.exec(hfContent)) !== null) {
      fields.add(match[1]);
    }
  }

  return Array.from(fields);
}

/**
 * Fill a .docx template buffer with given data object.
 * @param {Buffer} docxBuffer
 * @param {Object} data - Key-value pairs matching the {fields}
 * @returns {Buffer} - Filled .docx as Buffer
 */
function fillTemplate(docxBuffer, data) {
  const zip = new PizZip(docxBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });

  doc.render(data);

  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Convert a .docx buffer to PDF buffer using libreoffice-convert.
 * @param {Buffer} docxBuffer
 * @returns {Promise<Buffer>} - PDF as Buffer
 */
async function convertToPdf(docxBuffer) {
  // Dynamically require to avoid startup crash if LibreOffice isn't installed
  const libre = require("libreoffice-convert");
  const { promisify } = require("util");
  const libreConvert = promisify(libre.convert);

  const pdfBuffer = await libreConvert(docxBuffer, ".pdf", undefined);
  return pdfBuffer;
}

/**
 * Parse a CSV buffer and return array of row objects.
 * @param {Buffer} csvBuffer
 * @returns {Object[]}
 */
function parseCsv(csvBuffer) {
  const records = csvParse(csvBuffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  return records;
}

/**
 * Build two zip archives (docx zip + pdf zip) from a template and CSV rows.
 * Returns { docxZipBuffer, pdfZipBuffer }
 * @param {Buffer} templateBuffer
 * @param {Object[]} rows
 * @param {string} baseName - Base name for output files
 * @returns {Promise<{docxZipBuffer: Buffer, pdfZipBuffer: Buffer}>}
 */
async function buildBulkZips(templateBuffer, rows, baseName) {
  const docxBuffers = [];
  const pdfBuffers = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowLabel = row.name || row.Name || row.id || `row_${i + 1}`;
    const safeLabel = String(rowLabel).replace(/[^a-zA-Z0-9_\-]/g, "_");

    const filledDocx = fillTemplate(templateBuffer, row);
    docxBuffers.push({ name: `${safeLabel}_${i + 1}.docx`, buffer: filledDocx });

    const pdfBuffer = await convertToPdf(filledDocx);
    pdfBuffers.push({ name: `${safeLabel}_${i + 1}.pdf`, buffer: pdfBuffer });
  }

  // Pack docx zip
  const docxZipBuffer = await packZip(docxBuffers);
  const pdfZipBuffer = await packZip(pdfBuffers);

  return { docxZipBuffer, pdfZipBuffer };
}

/**
 * Pack an array of {name, buffer} objects into a zip Buffer.
 */
function packZip(files) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver("zip", { zlib: { level: 6 } });

    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    for (const file of files) {
      archive.append(file.buffer, { name: file.name });
    }

    archive.finalize();
  });
}

module.exports = {
  extractFields,
  fillTemplate,
  convertToPdf,
  parseCsv,
  buildBulkZips,
};
