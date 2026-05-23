const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const Transaction = require('../models/Transaction');
const { normalizeAsset } = require('../utils/assetNormalizer');
const { normalizeType } = require('../utils/typeMapper');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Inspects a raw CSV row and returns an array of detected data issues.
 * An empty array means the row is valid for matching.
 */
const collectIssues = (row) => {
  const issues = [];

  if (!row.transaction_id || row.transaction_id.trim() === '') {
    issues.push({ field: 'transaction_id', issue: 'Missing transaction ID' });
  }

  if (!row.timestamp || row.timestamp.trim() === '') {
    issues.push({ field: 'timestamp', issue: 'Missing timestamp' });
  } else if (isNaN(new Date(row.timestamp).getTime())) {
    issues.push({ field: 'timestamp', issue: `Malformed timestamp: "${row.timestamp}"` });
  }

  if (!row.type || row.type.trim() === '') {
    issues.push({ field: 'type', issue: 'Missing transaction type' });
  }

  if (!row.asset || row.asset.trim() === '') {
    issues.push({ field: 'asset', issue: 'Missing asset' });
  }

  if (row.quantity === undefined || row.quantity === null || row.quantity.trim() === '') {
    issues.push({ field: 'quantity', issue: 'Missing quantity' });
  } else if (isNaN(parseFloat(row.quantity))) {
    issues.push({ field: 'quantity', issue: `Non-numeric quantity: "${row.quantity}"` });
  } else if (parseFloat(row.quantity) < 0) {
    issues.push({ field: 'quantity', issue: `Negative quantity: ${row.quantity}` });
  }

  return issues;
};

// ---------------------------------------------------------------------------
// File parsing
// ---------------------------------------------------------------------------

/**
 * Reads and parses a single CSV file, validates every row, detects duplicates,
 * and returns an array of Transaction-shaped objects ready for insertion.
 */
const parseFile = (filePath, source, runId) => {
  // filePath arrives as an absolute path from config; resolve is a no-op but safe
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`CSV file not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf8');

  let rows;
  try {
    rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      // Tolerate rows with fewer columns than the header
      relax_column_count: true,
    });
  } catch (err) {
    throw new Error(`Failed to parse ${source} CSV: ${err.message}`);
  }

  const seenIds = new Set();
  const docs = [];

  for (const row of rows) {
    const issues = collectIssues(row);
    const txId = row.transaction_id?.trim() || null;

    // Duplicate detection within the same file
    const isDuplicate = txId !== null && seenIds.has(txId);
    if (isDuplicate) {
      issues.push({ field: 'transaction_id', issue: `Duplicate transaction ID: ${txId}` });
      logger.warn('Duplicate transaction detected', { source, transactionId: txId, runId });
    } else if (txId) {
      seenIds.add(txId);
    }

    const isValid = issues.length === 0;

    if (!isValid) {
      logger.warn('Data quality issue flagged (row will not be dropped)', {
        source,
        transactionId: txId,
        issues: issues.map((i) => i.issue),
        runId,
      });
    }

    // Safe coercions — preserve null when the value is absent or unparseable
    const tsRaw = row.timestamp?.trim();
    const tsDate = tsRaw && !isNaN(new Date(tsRaw).getTime()) ? new Date(tsRaw) : null;

    const qtyRaw = parseFloat(row.quantity);
    const priceRaw = parseFloat(row.price_usd);
    const feeRaw = parseFloat(row.fee);

    docs.push({
      runId,
      source,
      originalId: txId,
      timestamp: tsDate,
      type: row.type?.trim() || null,
      normalizedType: normalizeType(row.type),
      asset: row.asset?.trim() || null,
      normalizedAsset: normalizeAsset(row.asset),
      quantity: isNaN(qtyRaw) || qtyRaw < 0 ? null : qtyRaw,
      priceUsd: isNaN(priceRaw) ? null : priceRaw,
      fee: isNaN(feeRaw) ? null : feeRaw,
      note: row.note?.trim() || null,
      isValid,
      isDuplicate,
      dataIssues: issues,
      rawRow: row,
    });
  }

  return docs;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingests both CSV files for a reconciliation run.
 * All rows (valid and flagged) are persisted to MongoDB.
 * Returns ingestion counts used to populate the run summary.
 */
const ingest = async (userFile, exchangeFile, runId) => {
  const userDocs = parseFile(userFile, 'user', runId);
  const exchangeDocs = parseFile(exchangeFile, 'exchange', runId);

  await Transaction.insertMany([...userDocs, ...exchangeDocs], { ordered: false });

  const stats = {
    totalUser: userDocs.length,
    totalExchange: exchangeDocs.length,
    validUser: userDocs.filter((d) => d.isValid).length,
    validExchange: exchangeDocs.filter((d) => d.isValid).length,
    flaggedUser: userDocs.filter((d) => !d.isValid).length,
    flaggedExchange: exchangeDocs.filter((d) => !d.isValid).length,
  };

  logger.info('Ingestion complete', { runId, ...stats });
  return stats;
};

module.exports = { ingest };
