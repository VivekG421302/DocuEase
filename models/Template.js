const mongoose = require("mongoose");

const TemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    telegramFileId: {
      type: String,
      required: true,
    },
    fields: {
      type: [String],
      required: true,
      default: [],
    },
    originalFileName: {
      type: String,
      required: true,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Template", TemplateSchema);
