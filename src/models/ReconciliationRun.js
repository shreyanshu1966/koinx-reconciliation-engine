const mongoose = require('mongoose');

const reconciliationRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    config: {
      timestampToleranceSeconds: Number,
      quantityTolerancePct: Number,
    },
    summary: {
      totalUser: { type: Number, default: 0 },
      totalExchange: { type: Number, default: 0 },
      validUser: { type: Number, default: 0 },
      validExchange: { type: Number, default: 0 },
      flaggedUser: { type: Number, default: 0 },
      flaggedExchange: { type: Number, default: 0 },
      matched: { type: Number, default: 0 },
      conflicting: { type: Number, default: 0 },
      unmatchedUser: { type: Number, default: 0 },
      unmatchedExchange: { type: Number, default: 0 },
    },
    reportPath: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReconciliationRun', reconciliationRunSchema);
