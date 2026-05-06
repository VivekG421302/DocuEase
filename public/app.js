/* ════════════════════════════════════════
   DocuEase — Frontend App Logic
════════════════════════════════════════ */

const API = "";  // Same origin; no need for base URL

// ── State ─────────────────────────────────────
let state = {
  page: "new",
  mode: "single",       // "single" | "bulk"
  docxFile: null,
  csvFile: null,
  fields: [],
  currentTemplateId: null,
  currentTemplate: null,
  useMode: "single",
};

// ── DOM Helpers ───────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id) => $(id)?.classList.remove("hidden");
const hide = (id) => $(id)?.classList.add("hidden");

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  const target = $(`page-${name}`);
  if (target) {
    target.classList.add("active");
    target.style.display = "block";
  }
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === name);
  });
  state.page = name;
}

function showToast(msg, type = "") {
  const toast = $("toast");
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  show("toast");
  setTimeout(() => hide("toast"), 3500);
}

function showLoader(msg = "Processing…") {
  $("loader-msg").textContent = msg;
  show("loader-overlay");
}

function hideLoader() {
  hide("loader-overlay");
}

// ── Base64 Download ───────────────────────────
function downloadBase64(base64, fileName, mimeType) {
  const byteChars = atob(base64);
  const arr = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) arr[i] = byteChars.charCodeAt(i);
  const blob = new Blob([arr], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function makeDownloadBtn(label, icon, cls, onClick) {
  const btn = document.createElement("button");
  btn.className = `download-btn ${cls}`;
  btn.innerHTML = `<span class="download-icon">${icon}</span> ${label}`;
  btn.onclick = onClick;
  return btn;
}

// ── Navigation ────────────────────────────────
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.page;
    if (target === "library") loadLibrary();
    showPage(target);
  });
});

// ── File Upload Zone (DOCX) ───────────────────
const uploadZone = $("upload-zone");
const fileInput = $("file-input");

uploadZone.addEventListener("click", () => fileInput.click());
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("dragging");
});
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragging"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragging");
  const file = e.dataTransfer.files[0];
  if (file) handleDocxFile(file);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleDocxFile(fileInput.files[0]);
});

$("file-change").addEventListener("click", () => {
  fileInput.value = "";
  state.docxFile = null;
  hide("file-chosen");
  show("upload-zone");
});

function handleDocxFile(file) {
  if (!file.name.endsWith(".docx")) {
    showToast("Please choose a .docx Word file.", "error");
    return;
  }
  state.docxFile = file;
  $("file-chosen-name").textContent = file.name;
  $("template-name").placeholder = file.name.replace(".docx", "");
  hide("upload-zone");
  show("file-chosen");
}

// ── Save template checkbox ────────────────────
$("save-template").addEventListener("change", (e) => {
  if (e.target.checked) show("template-name-row");
  else hide("template-name-row");
});
show("template-name-row"); // default shown since checked

// ── Mode Buttons (new doc) ────────────────────
document.querySelectorAll("[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-mode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
  });
});

// ── CSV Upload Zone ───────────────────────────
const csvZone = $("csv-upload-zone");
const csvInput = $("csv-input");

csvZone.addEventListener("click", () => csvInput.click());
csvInput.addEventListener("change", () => {
  if (csvInput.files[0]) handleCsvFile(csvInput.files[0], "main");
});
$("csv-file-change").addEventListener("click", () => {
  csvInput.value = "";
  state.csvFile = null;
  hide("csv-file-chosen");
  show("csv-upload-zone");
});

function handleCsvFile(file, context = "main") {
  if (!file.name.endsWith(".csv")) {
    showToast("Please choose a .csv file.", "error");
    return;
  }
  state.csvFile = file;
  if (context === "main") {
    $("csv-file-name").textContent = file.name;
    hide("csv-upload-zone");
    show("csv-file-chosen");
  }
}

// ── STEP 1: Scan for fields ───────────────────
$("btn-scan").addEventListener("click", async () => {
  if (!state.docxFile) {
    showToast("Please choose a .docx file first.", "error");
    return;
  }

  showLoader("Scanning your document for fields…");

  const formData = new FormData();
  formData.append("template", state.docxFile);

  try {
    const res = await fetch(`${API}/api/scan`, { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || "Scan failed");

    state.fields = data.fields;

    if (state.mode === "single") {
      buildSingleForm(data.fields);
      hide("step1");
      show("step2-single");
    } else {
      buildBulkInfo(data.fields);
      hide("step1");
      show("step2-bulk");
    }

    showToast(`Found ${data.fields.length} field(s) in your document!`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    hideLoader();
  }
});

// ── Build Single Form ─────────────────────────
function buildSingleForm(fields) {
  const container = $("single-form-fields");
  container.innerHTML = "";
  fields.forEach((field) => {
    const group = document.createElement("div");
    group.className = "field-group";
    group.innerHTML = `
      <label class="field-label" for="field-${field}">${formatFieldName(field)}</label>
      <input type="text" id="field-${field}" class="field-input" placeholder="Enter ${formatFieldName(field)}" />
    `;
    container.appendChild(group);
  });
}

function formatFieldName(field) {
  return field
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function collectFormData(fields, prefix = "field-") {
  const data = {};
  fields.forEach((field) => {
    const el = document.getElementById(`${prefix}${field}`);
    data[field] = el ? el.value.trim() : "";
  });
  return data;
}

// ── Build Bulk Info ───────────────────────────
function buildBulkInfo(fields) {
  $("bulk-fields-required").textContent = fields.join(", ");
}

// ── Back Buttons ──────────────────────────────
$("btn-back-single").addEventListener("click", () => {
  hide("step2-single");
  show("step1");
});
$("btn-back-bulk").addEventListener("click", () => {
  hide("step2-bulk");
  show("step1");
});

// ── STEP 2a: Generate Single ──────────────────
$("btn-generate-single").addEventListener("click", async () => {
  const data = collectFormData(state.fields);
  const empty = state.fields.filter((f) => !data[f]);
  if (empty.length) {
    showToast(`Please fill in: ${empty.map(formatFieldName).join(", ")}`, "error");
    return;
  }

  showLoader("Generating your Word and PDF files…");

  try {
    // If saving the template
    if ($("save-template").checked) {
      await doSaveAndGenerate(data);
    } else {
      await doUploadAndGenerate(data);
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    hideLoader();
  }
});

async function doSaveAndGenerate(data) {
  // Upload + save template first
  const uploadForm = new FormData();
  uploadForm.append("template", state.docxFile);
  uploadForm.append("name", $("template-name").value || state.docxFile.name.replace(".docx", ""));

  const uploadRes = await fetch(`${API}/api/upload`, { method: "POST", body: uploadForm });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(uploadData.error);

  const templateId = uploadData.template.id;

  // Generate from saved template
  const genRes = await fetch(`${API}/api/generate/single`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, data }),
  });
  const genData = await genRes.json();
  if (!genRes.ok) throw new Error(genData.error);

  showDownloads(genData, "single");
  showToast("Template saved to your library! ✅", "success");
}

async function doUploadAndGenerate(data) {
  const form = new FormData();
  form.append("template", state.docxFile);
  form.append("data", JSON.stringify(data));

  const res = await fetch(`${API}/api/generate/single-upload`, { method: "POST", body: form });
  const genData = await res.json();
  if (!res.ok) throw new Error(genData.error);

  showDownloads(genData, "single");
}

// ── STEP 2b: Generate Bulk ────────────────────
$("btn-generate-bulk").addEventListener("click", async () => {
  if (!state.csvFile) {
    showToast("Please choose a .csv file.", "error");
    return;
  }

  showLoader("Generating all documents — this may take a moment…");

  try {
    if ($("save-template").checked) {
      await doSaveAndGenerateBulk();
    } else {
      await doUploadAndGenerateBulk();
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    hideLoader();
  }
});

async function doSaveAndGenerateBulk() {
  const uploadForm = new FormData();
  uploadForm.append("template", state.docxFile);
  uploadForm.append("name", $("template-name").value || state.docxFile.name.replace(".docx", ""));

  const uploadRes = await fetch(`${API}/api/upload`, { method: "POST", body: uploadForm });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(uploadData.error);

  const form = new FormData();
  form.append("templateId", uploadData.template.id);
  form.append("csv", state.csvFile);

  const res = await fetch(`${API}/api/generate/bulk`, { method: "POST", body: form });
  const genData = await res.json();
  if (!res.ok) throw new Error(genData.error);

  showDownloads(genData, "bulk");
  showToast("Template saved to your library! ✅", "success");
}

async function doUploadAndGenerateBulk() {
  const form = new FormData();
  form.append("template", state.docxFile);
  form.append("csv", state.csvFile);

  const res = await fetch(`${API}/api/generate/bulk-upload`, { method: "POST", body: form });
  const genData = await res.json();
  if (!res.ok) throw new Error(genData.error);

  showDownloads(genData, "bulk");
}

// ── Show Downloads (Step 3) ───────────────────
function showDownloads(genData, type) {
  const grid = $("download-grid");
  grid.innerHTML = "";

  if (type === "single") {
    $("step3-desc").textContent = "Your filled Word document and PDF are ready.";

    const docxBtn = makeDownloadBtn("Download Word (.docx)", "📄", "docx", () => {
      downloadBase64(
        genData.docx,
        `${genData.fileName}_filled.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    });

    const pdfBtn = makeDownloadBtn("Download PDF", "📋", "pdf", () => {
      downloadBase64(genData.pdf, `${genData.fileName}_filled.pdf`, "application/pdf");
    });

    grid.appendChild(docxBtn);
    grid.appendChild(pdfBtn);
  } else {
    $("step3-desc").textContent = `Generated ${genData.count} documents. Download both zip files below.`;

    const docxZipBtn = makeDownloadBtn(`Download ${genData.count} Word Files (.zip)`, "📦", "zip-docx", () => {
      downloadBase64(genData.docxZip, `${genData.fileName}_docx_files.zip`, "application/zip");
    });

    const pdfZipBtn = makeDownloadBtn(`Download ${genData.count} PDF Files (.zip)`, "📦", "zip-pdf", () => {
      downloadBase64(genData.pdfZip, `${genData.fileName}_pdf_files.zip`, "application/zip");
    });

    grid.appendChild(docxZipBtn);
    grid.appendChild(pdfZipBtn);
  }

  hide("step2-single");
  hide("step2-bulk");
  show("step3");
}

$("btn-start-over").addEventListener("click", resetNewPage);
$("btn-go-library").addEventListener("click", () => {
  loadLibrary();
  showPage("library");
});

function resetNewPage() {
  state.docxFile = null;
  state.csvFile = null;
  state.fields = [];
  fileInput.value = "";
  csvInput.value = "";
  hide("file-chosen");
  show("upload-zone");
  hide("csv-file-chosen");
  show("csv-upload-zone");
  hide("step2-single");
  hide("step2-bulk");
  hide("step3");
  show("step1");
  $("single-form-fields").innerHTML = "";
}

// ── LIBRARY ───────────────────────────────────
async function loadLibrary() {
  show("library-loading");
  hide("library-empty");
  hide("library-grid");

  try {
    const res = await fetch(`${API}/api/templates`);
    const data = await res.json();
    hide("library-loading");

    if (!data.templates || data.templates.length === 0) {
      show("library-empty");
      return;
    }

    renderLibrary(data.templates);
    show("library-grid");
  } catch (err) {
    hide("library-loading");
    showToast("Could not load library: " + err.message, "error");
  }
}

function renderLibrary(templates) {
  const grid = $("library-grid");
  grid.innerHTML = "";
  templates.forEach((tmpl) => {
    const card = document.createElement("div");
    card.className = "template-card";
    card.innerHTML = `
      <button class="template-card-delete" title="Delete template" data-id="${tmpl._id}">🗑️</button>
      <div class="template-card-icon">📄</div>
      <div class="template-card-name">${escHtml(tmpl.name)}</div>
      <div class="template-card-fields">Fields: ${tmpl.fields.map(escHtml).join(", ")}</div>
      <div class="template-card-meta">
        <span>📊 Used ${tmpl.usageCount}×</span>
        <span>•</span>
        <span>${new Date(tmpl.createdAt).toLocaleDateString()}</span>
      </div>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest(".template-card-delete")) return;
      openTemplateUse(tmpl);
    });

    card.querySelector(".template-card-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${tmpl.name}"? This cannot be undone.`)) return;
      try {
        await fetch(`${API}/api/templates/${tmpl._id}`, { method: "DELETE" });
        showToast("Template deleted.", "success");
        loadLibrary();
      } catch (err) {
        showToast("Delete failed: " + err.message, "error");
      }
    });

    grid.appendChild(card);
  });
}

$("btn-go-new").addEventListener("click", () => showPage("new"));

// ── USE TEMPLATE ──────────────────────────────
function openTemplateUse(tmpl) {
  state.currentTemplate = tmpl;
  state.currentTemplateId = tmpl._id;
  state.useMode = "single";

  $("use-template-title").textContent = tmpl.name;
  $("use-template-fields-list").textContent = tmpl.fields.join(", ");
  $("use-bulk-fields-required").textContent = tmpl.fields.join(", ");

  // Build single form
  buildUseSingleForm(tmpl.fields);

  // Reset mode buttons
  document.querySelectorAll("[data-usemode]").forEach((b) => b.classList.remove("active"));
  document.querySelector('[data-usemode="single"]').classList.add("active");

  show("use-single-form");
  hide("use-bulk-form");
  hide("use-downloads");

  // Reset CSV
  state.csvFile = null;
  hide("use-csv-chosen");
  show("use-csv-zone");

  showPage("use-template");
}

function buildUseSingleForm(fields) {
  const container = $("use-single-fields");
  container.innerHTML = "";
  fields.forEach((field) => {
    const group = document.createElement("div");
    group.className = "field-group";
    group.innerHTML = `
      <label class="field-label" for="use-field-${field}">${formatFieldName(field)}</label>
      <input type="text" id="use-field-${field}" class="field-input" placeholder="Enter ${formatFieldName(field)}" />
    `;
    container.appendChild(group);
  });
}

// Use-mode toggle
document.querySelectorAll("[data-usemode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-usemode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.useMode = btn.dataset.usemode;
    if (state.useMode === "single") {
      show("use-single-form");
      hide("use-bulk-form");
    } else {
      hide("use-single-form");
      show("use-bulk-form");
    }
    hide("use-downloads");
  });
});

// Use CSV upload
const useCsvZone = $("use-csv-zone");
const useCsvInput = $("use-csv-input");
useCsvZone.addEventListener("click", () => useCsvInput.click());
useCsvInput.addEventListener("change", () => {
  if (useCsvInput.files[0]) {
    state.csvFile = useCsvInput.files[0];
    $("use-csv-name").textContent = useCsvInput.files[0].name;
    hide("use-csv-zone");
    show("use-csv-chosen");
  }
});

// Generate single from library
$("btn-use-generate-single").addEventListener("click", async () => {
  const tmpl = state.currentTemplate;
  const data = collectFormData(tmpl.fields, "use-field-");
  const empty = tmpl.fields.filter((f) => !data[f]);
  if (empty.length) {
    showToast(`Please fill in: ${empty.map(formatFieldName).join(", ")}`, "error");
    return;
  }

  showLoader("Generating your documents…");
  try {
    const res = await fetch(`${API}/api/generate/single`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: state.currentTemplateId, data }),
    });
    const genData = await res.json();
    if (!res.ok) throw new Error(genData.error);
    showUseDownloads(genData, "single");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    hideLoader();
  }
});

// Generate bulk from library
$("btn-use-generate-bulk").addEventListener("click", async () => {
  if (!state.csvFile) {
    showToast("Please choose a .csv file.", "error");
    return;
  }
  showLoader("Generating all documents…");
  try {
    const form = new FormData();
    form.append("templateId", state.currentTemplateId);
    form.append("csv", state.csvFile);

    const res = await fetch(`${API}/api/generate/bulk`, { method: "POST", body: form });
    const genData = await res.json();
    if (!res.ok) throw new Error(genData.error);
    showUseDownloads(genData, "bulk");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    hideLoader();
  }
});

function showUseDownloads(genData, type) {
  const grid = $("use-download-grid");
  grid.innerHTML = "";

  if (type === "single") {
    grid.appendChild(makeDownloadBtn("Download Word (.docx)", "📄", "docx", () => {
      downloadBase64(genData.docx, `${genData.fileName}_filled.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    }));
    grid.appendChild(makeDownloadBtn("Download PDF", "📋", "pdf", () => {
      downloadBase64(genData.pdf, `${genData.fileName}_filled.pdf`, "application/pdf");
    }));
  } else {
    grid.appendChild(makeDownloadBtn(`Download ${genData.count} Word Files (.zip)`, "📦", "zip-docx", () => {
      downloadBase64(genData.docxZip, `${genData.fileName}_docx_files.zip`, "application/zip");
    }));
    grid.appendChild(makeDownloadBtn(`Download ${genData.count} PDF Files (.zip)`, "📦", "zip-pdf", () => {
      downloadBase64(genData.pdfZip, `${genData.fileName}_pdf_files.zip`, "application/zip");
    }));
  }

  show("use-downloads");
}

$("btn-use-again").addEventListener("click", () => {
  hide("use-downloads");
  if (state.useMode === "single") show("use-single-form");
  else show("use-bulk-form");
});

$("btn-back-to-library").addEventListener("click", () => {
  loadLibrary();
  showPage("library");
});
$("btn-use-back-lib").addEventListener("click", () => {
  loadLibrary();
  showPage("library");
});

// ── Utility ───────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Init ──────────────────────────────────────
showPage("new");
