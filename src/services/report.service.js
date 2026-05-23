const fs = require('fs');
const path = require('path');
const ReconciliationResult = require('../models/ReconciliationResult');
const { toCsv } = require('../utils/csvWriter');
const config = require('../config');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// CSV report layout
// ---------------------------------------------------------------------------

const REPORT_HEADERS = [
  'category',
  'reason',
  'time_diff_seconds',
  'quantity_diff_pct',
  // User-side fields
  'user_transaction_id',
  'user_timestamp',
  'user_type',
  'user_asset',
  'user_quantity',
  'user_price_usd',
  'user_fee',
  'user_note',
  'user_data_issues',
  // Exchange-side fields
  'exchange_transaction_id',
  'exchange_timestamp',
  'exchange_type',
  'exchange_asset',
  'exchange_quantity',
  'exchange_price_usd',
  'exchange_fee',
  'exchange_note',
  'exchange_data_issues',
];

const txField = (tx, field) => (tx ? (tx[field] ?? '') : '');

// Emit timestamps as ISO 8601 strings for portability
const txTimestamp = (tx) => {
  const ts = tx?.timestamp;
  if (!ts) return '';
  return new Date(ts).toISOString();
};

const resultToRow = (r) => [
  r.category,
  r.reason,
  r.timeDiffSeconds ?? '',
  r.quantityDiffPct != null ? r.quantityDiffPct.toFixed(6) : '',
  // User side
  txField(r.userTransaction, 'originalId'),
  txTimestamp(r.userTransaction),
  txField(r.userTransaction, 'type'),
  txField(r.userTransaction, 'asset'),
  txField(r.userTransaction, 'quantity'),
  txField(r.userTransaction, 'priceUsd'),
  txField(r.userTransaction, 'fee'),
  txField(r.userTransaction, 'note'),
  r.userTransaction?.dataIssues?.map((i) => i.issue).join(' | ') ?? '',
  // Exchange side
  txField(r.exchangeTransaction, 'originalId'),
  txTimestamp(r.exchangeTransaction),
  txField(r.exchangeTransaction, 'type'),
  txField(r.exchangeTransaction, 'asset'),
  txField(r.exchangeTransaction, 'quantity'),
  txField(r.exchangeTransaction, 'priceUsd'),
  txField(r.exchangeTransaction, 'fee'),
  txField(r.exchangeTransaction, 'note'),
  r.exchangeTransaction?.dataIssues?.map((i) => i.issue).join(' | ') ?? '',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates the CSV reconciliation report for a completed run, writes it to
 * the reports directory, and returns the absolute file path.
 */
const generateCsvReport = async (runId) => {
  const results = await ReconciliationResult.find({ runId })
    .sort({ category: 1, createdAt: 1 })
    .lean();

  const csv = toCsv(REPORT_HEADERS, resultToRow, results);

  const reportsDir = path.resolve(config.reportsDir);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const fileName = `reconciliation_${runId}.csv`;
  const filePath = path.join(reportsDir, fileName);
  fs.writeFileSync(filePath, csv, 'utf8');

  logger.info('CSV report written', { runId, filePath, rows: results.length });
  return filePath;
};

/**
 * Returns all reconciliation results for a run as plain objects.
 */
const getFullReport = async (runId) => {
  return ReconciliationResult.find({ runId })
    .sort({ category: 1, createdAt: 1 })
    .lean();
};

/**
 * Returns only unmatched results (both user-only and exchange-only).
 */
const getUnmatchedReport = async (runId) => {
  return ReconciliationResult.find({
    runId,
    category: { $in: ['unmatched_user', 'unmatched_exchange'] },
  })
    .sort({ category: 1, createdAt: 1 })
    .lean();
};

module.exports = { generateCsvReport, getFullReport, getUnmatchedReport };
