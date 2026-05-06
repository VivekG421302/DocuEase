const axios = require("axios");
const FormData = require("form-data");

function getTelegramConfig() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim(),
    chatId: process.env.TELEGRAM_CHAT_ID?.trim(),
  };
}

/**
 * Upload a file buffer to Telegram and return the file_id.
 * @param {Buffer} fileBuffer - The file content as a Buffer
 * @param {string} fileName - Original filename (e.g. "template.docx")
 * @returns {Promise<string>} - The Telegram file_id string
 */
async function uploadToTelegram(fileBuffer, fileName) {
  const { botToken, chatId } = getTelegramConfig();

  if (!botToken || !chatId) {
    throw new Error(
      "Telegram credentials not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."
    );
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", fileBuffer, {
    filename: fileName,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  form.append("caption", `DocuEase Template: ${fileName}`);

  const response = await axios.post(
    `https://api.telegram.org/bot${botToken}/sendDocument`,
    form,
    { headers: form.getHeaders() }
  );

  if (!response.data.ok) {
    throw new Error(
      `Telegram upload failed: ${JSON.stringify(response.data)}`
    );
  }

  const fileId = response.data.result.document.file_id;
  return fileId;
}

/**
 * Download a file from Telegram by file_id and return as Buffer.
 * @param {string} fileId - The Telegram file_id
 * @returns {Promise<Buffer>} - The file content as a Buffer
 */
async function downloadFromTelegram(fileId) {
  const { botToken } = getTelegramConfig();

  if (!botToken) {
    throw new Error(
      "Telegram credentials not configured. Set TELEGRAM_BOT_TOKEN."
    );
  }

  // Step 1: Get the file path from Telegram
  const fileInfoResponse = await axios.get(
    `https://api.telegram.org/bot${botToken}/getFile`,
    { params: { file_id: fileId } }
  );

  if (!fileInfoResponse.data.ok) {
    throw new Error(
      `Failed to get file info from Telegram: ${JSON.stringify(
        fileInfoResponse.data
      )}`
    );
  }

  const filePath = fileInfoResponse.data.result.file_path;

  // Step 2: Download the actual file
  const fileResponse = await axios.get(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
    { responseType: "arraybuffer" }
  );

  return Buffer.from(fileResponse.data);
}

module.exports = { uploadToTelegram, downloadFromTelegram };
