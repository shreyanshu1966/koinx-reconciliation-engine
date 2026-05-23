const mongoose = require('mongoose');

const reconciliationResultSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: ['matched', 'conflicting', 'unmatched_user', 'unmatched_exchange'],
      required: true,
      index: true,
    },
    // Full snapshots of the matched rows (null when one side is absent)
    userTransaction: { type: mongoose.Schema.Types.Mixed, default: null },
    exchangeTransaction: { type: mongoose.Schema.Types.Mixed, default: null },

    reason: { type: String },
    timeDiffSeconds: { type: Number, default: null },
    quantityDiffPct: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReconciliationResult', reconciliationResultSchema);
