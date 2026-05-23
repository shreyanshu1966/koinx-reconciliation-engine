const mongoose = require('mongoose');

const dataIssueSchema = new mongoose.Schema(
  { field: String, issue: String },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    source: { type: String, enum: ['user', 'exchange'], required: true },

    // Raw identifiers preserved as-is from the CSV
    originalId: { type: String, default: null },

    // Parsed / normalised fields used by the matching engine
    timestamp: { type: Date, default: null },
    type: { type: String, default: null },
    normalizedType: { type: String, default: null },
    asset: { type: String, default: null },
    normalizedAsset: { type: String, default: null },
    quantity: { type: Number, default: null },
    priceUsd: { type: Number, default: null },
    fee: { type: Number, default: null },
    note: { type: String, default: null },

    // Data-quality bookkeeping
    isValid: { type: Boolean, default: true },
    isDuplicate: { type: Boolean, default: false },
    dataIssues: { type: [dataIssueSchema], default: [] },

    // Original CSV row stored for auditability
    rawRow: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
