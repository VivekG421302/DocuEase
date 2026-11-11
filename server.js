require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const cors = require("cors");

const Template = require("./models/Template");
const { uploadToTelegram, downloadFromTelegram } = require("./services/telegram");
const {
  extractFields,
  fillTemplate,
  convertToPdf,
  parseCsv,
  buildBulkZips,
} = require("./services/processor");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Multer: store uploads in memory (no disk storage needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/csv",
      "application/csv",
      "application/octet-stream",
    ];
    // Allow by extension as a fallback
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || [".docx", ".csv"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only .docx and .csv files are accepted."));
    }
  },
});

// ─── MongoDB (lazy + cached so it works in serverless environments) ──────────
let dbPromise = null;
function connectDb() {
  if (!process.env.MONGODB_URI) {
    return Promise.reject(new Error("MONGODB_URI is not set."));
  }
  if (!dbPromise) {
    dbPromise = mongoose
      .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
      .then((m) => {
        console.log("✅ Connected to MongoDB Atlas");
        return m;
      })
      .catch((err) => {
        dbPromise = null; // allow retry on next request
        throw err;
      });
  }
  return dbPromise;
}

// Middleware for routes that need the database
async function withDb(req, res, next) {
  try {
    await connectDb();
    next();
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    res.status(500).json({ error: "Database connection failed: " + err.message });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Health check
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * POST /api/upload
 * Upload a new .docx template, extract fields, save to Telegram + MongoDB.
 * Body: multipart with field "template" (.docx) and "name" (string)
 */
app.post("/api/upload", withDb, upload.single("template"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No .docx file uploaded." });
    }

    const templateName = req.body.name?.trim() || req.file.originalname.replace(".docx", "");

    // Extract {fields} from the document
    const fields = extractFields(req.file.buffer);

    if (fields.length === 0) {
      return res.status(400).json({
        error:
          "No placeholders found in this document. Make sure you have fields like {name}, {date}, etc.",
      });
    }

    // Upload to Telegram for storage
    const telegramFileId = await uploadToTelegram(
      req.file.buffer,
      req.file.originalname
    );

    // Save metadata to MongoDB
    const template = await Template.create({
      name: templateName,
      telegramFileId,
      fields,
      originalFileName: req.file.originalname,
    });

    res.json({
      success: true,
      template: {
        id: template._id,
        name: template.name,
        fields: template.fields,
        originalFileName: template.originalFileName,
        createdAt: template.createdAt,
      },
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/templates
 * List all saved templates
 */
app.get("/api/templates", withDb, async (req, res) => {
  try {
    const templates = await Template.find({})
      .sort({ createdAt: -1 })
      .select("name fields originalFileName usageCount createdAt");
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/templates/:id
 * Get a single template's metadata
 */
app.get("/api/templates/:id", withDb, async (req, res) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found." });
    res.json({ template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/templates/:id
 * Delete a template from the library
 */
app.delete("/api/templates/:id", withDb, async (req, res) => {
  try {
    await Template.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/generate/single
 * Generate a single filled DOCX + PDF from a saved template.
 * Body: { templateId, data: { field1: val1, ... } }
 */
app.post("/api/generate/single", withDb, async (req, res) => {
  try {
    const { templateId, data } = req.body;

    if (!templateId || !data) {
      return res.status(400).json({ error: "templateId and data are required." });
    }

    const template = await Template.findById(templateId);
    if (!template) return res.status(404).json({ error: "Template not found." });

    // Download template from Telegram
    const templateBuffer = await downloadFromTelegram(template.telegramFileId);

    // Fill DOCX
    const filledDocx = fillTemplate(templateBuffer, data);

    // Convert to PDF
    const pdfBuffer = await convertToPdf(filledDocx);

    // Update usage count
    await Template.findByIdAndUpdate(templateId, { $inc: { usageCount: 1 } });

    // Send both files as base64 in JSON response
    res.json({
      success: true,
      docx: filledDocx.toString("base64"),
      pdf: pdfBuffer ? pdfBuffer.toString("base64") : null,
      fileName: template.originalFileName.replace(".docx", ""),
    });
  } catch (err) {
    console.error("Single generate error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/generate/single-upload
 * Generate from a freshly uploaded template (not yet saved).
 * Body: multipart with "template" (.docx) and JSON "data" field
 */
app.post(
  "/api/generate/single-upload",
  upload.single("template"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No template file." });
      }

      const data = JSON.parse(req.body.data || "{}");
      const filledDocx = fillTemplate(req.file.buffer, data);
      const pdfBuffer = await convertToPdf(filledDocx);

      res.json({
        success: true,
        docx: filledDocx.toString("base64"),
        pdf: pdfBuffer ? pdfBuffer.toString("base64") : null,
        fileName: req.file.originalname.replace(".docx", ""),
      });
    } catch (err) {
      console.error("Single-upload generate error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/generate/bulk
 * Generate bulk DOCX + PDF from saved template + CSV.
 * Body: multipart with "csv" file and "templateId" field
 */
app.post("/api/generate/bulk", withDb, upload.single("csv"), async (req, res) => {
  try {
    const { templateId } = req.body;

    if (!req.file || !templateId) {
      return res.status(400).json({ error: "csv file and templateId are required." });
    }

    const template = await Template.findById(templateId);
    if (!template) return res.status(404).json({ error: "Template not found." });

    // Parse CSV
    const rows = parseCsv(req.file.buffer);
    if (rows.length === 0) {
      return res.status(400).json({ error: "CSV file is empty or has no valid rows." });
    }

    // Download template from Telegram
    const templateBuffer = await downloadFromTelegram(template.telegramFileId);

    // Build zips
    const { docxZipBuffer, pdfZipBuffer } = await buildBulkZips(
      templateBuffer,
      rows,
      template.name
    );

    await Template.findByIdAndUpdate(templateId, { $inc: { usageCount: rows.length } });

    res.json({
      success: true,
      docxZip: docxZipBuffer.toString("base64"),
      pdfZip: pdfZipBuffer ? pdfZipBuffer.toString("base64") : null,
      count: rows.length,
      fileName: template.name,
    });
  } catch (err) {
    console.error("Bulk generate error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/generate/bulk-upload
 * Generate bulk from freshly uploaded template + CSV.
 * Body: multipart with "template" (.docx) and "csv" files
 */
app.post(
  "/api/generate/bulk-upload",
  upload.fields([{ name: "template" }, { name: "csv" }]),
  async (req, res) => {
    try {
      const templateFile = req.files?.template?.[0];
      const csvFile = req.files?.csv?.[0];

      if (!templateFile || !csvFile) {
        return res.status(400).json({ error: "Both template and csv files are required." });
      }

      const rows = parseCsv(csvFile.buffer);
      if (rows.length === 0) {
        return res.status(400).json({ error: "CSV file is empty." });
      }

      const { docxZipBuffer, pdfZipBuffer } = await buildBulkZips(
        templateFile.buffer,
        rows,
        templateFile.originalname.replace(".docx", "")
      );

      res.json({
        success: true,
        docxZip: docxZipBuffer.toString("base64"),
        pdfZip: pdfZipBuffer ? pdfZipBuffer.toString("base64") : null,
        count: rows.length,
        fileName: templateFile.originalname.replace(".docx", ""),
      });
    } catch (err) {
      console.error("Bulk-upload generate error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/scan
 * Scan a .docx for {fields} without saving.
 * Body: multipart with "template" (.docx)
 */
app.post("/api/scan", upload.single("template"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    const fields = extractFields(req.file.buffer);
    res.json({ fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
// On Vercel the app is imported by api/index.js and must not call listen().
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 DocuEase running at http://localhost:${PORT}`);
    connectDb().catch((err) =>
      console.error("❌ MongoDB connection error:", err.message)
    );
  });
}

module.exports = app;
