const Transaction = require('../models/Transaction');
const ReconciliationResult = require('../models/ReconciliationResult');
const { areTypesCompatible } = require('../utils/typeMapper');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

const secondsBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 1000);

/**
 * Percentage difference of `actual` relative to `reference`.
 * Returns Infinity when reference is 0 and actual is non-zero.
 */
const pctDiff = (actual, reference) => {
  if (reference === 0) return actual === 0 ? 0 : Infinity;
  return Math.abs((actual - reference) / reference) * 100;
};

// ---------------------------------------------------------------------------
// Core matching logic
// ---------------------------------------------------------------------------

/**
 * For a single user transaction, scans the provided exchange candidates and
 * returns the best outcome: a full match, a conflict, or null (no match).
 *
 * Categories:
 *   matched    — asset, type, timestamp AND quantity all within tolerance
 *   conflicting — asset & type compatible, within 2× timestamp tolerance,
 *                 but quantity or timestamp outside primary tolerance
 *
 * The greedy approach picks the exchange candidate with the smallest time
 * delta to minimise false conflicts when multiple candidates are present.
 */
const findBestCandidate = (userTx, candidates, tolerances) => {
  const { timestampToleranceSeconds, quantityTolerancePct } = tolerances;
  // Wider window used to identify "probably the same event" for conflict tagging
  const conflictTimeWindow = timestampToleranceSeconds * 2;

  let bestMatch = null;       // full match — lowest timeDiff wins
  let bestMatchScore = Infinity;
  let bestConflict = null;    // conflict — lowest timeDiff wins
  let bestConflictScore = Infinity;

  for (const exc of candidates) {
    if (!areTypesCompatible(userTx.normalizedType, exc.normalizedType)) continue;
    if (userTx.normalizedAsset !== exc.normalizedAsset) continue;

    const timeDiff = secondsBetween(userTx.timestamp, exc.timestamp);
    const qtyDiff = pctDiff(userTx.quantity, exc.quantity);

    const withinTime = timeDiff <= timestampToleranceSeconds;
    const withinQty = qtyDiff <= quantityTolerancePct;
    const nearTime = timeDiff <= conflictTimeWindow;

    if (withinTime && withinQty) {
      if (timeDiff < bestMatchScore) {
        bestMatchScore = timeDiff;
        bestMatch = { tx: exc, timeDiff, qtyDiff };
      }
    } else if (nearTime) {
      // Close enough in time to be the same event, but values diverge
      if (timeDiff < bestConflictScore) {
        bestConflictScore = timeDiff;
        bestConflict = { tx: exc, timeDiff, qtyDiff };
      }
    }
  }

  if (bestMatch) return { outcome: 'matched', ...bestMatch };
  if (bestConflict) return { outcome: 'conflicting', ...bestConflict };
  return null;
};

/**
 * Builds the human-readable reason string for a conflicting pair.
 */
const buildConflictReason = (timeDiff, qtyDiff, tolerances) => {
  const parts = [];
  if (timeDiff > tolerances.timestampToleranceSeconds) {
    parts.push(
      `timestamp diff ${timeDiff.toFixed(1)}s exceeds tolerance of ${tolerances.timestampToleranceSeconds}s`
    );
  }
  if (qtyDiff > tolerances.quantityTolerancePct) {
    parts.push(
      `quantity diff ${qtyDiff.toFixed(4)}% exceeds tolerance of ${tolerances.quantityTolerancePct}%`
    );
  }
  return `Conflicting: ${parts.join('; ')}`;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the full matching pipeline for a reconciliation run and persists all
 * ReconciliationResult documents.
 *
 * Algorithm (greedy):
 *  1. Load valid transactions for this run from MongoDB.
 *  2. Group exchange transactions by normalised asset for O(1) candidate lookup.
 *  3. For each user transaction (sorted by timestamp), find the best exchange
 *     candidate that hasn't already been claimed.
 *  4. Any unclaimed exchange transaction → unmatched_exchange.
 *  5. Invalid / flagged transactions from both sides → unmatched_* with reason.
 *
 * Returns the summary counts.
 */
const match = async (runId, tolerances) => {
  const [validUserTxs, validExchangeTxs, invalidUserTxs, invalidExchangeTxs] = await Promise.all([
    Transaction.find({ runId, source: 'user', isValid: true }).lean(),
    Transaction.find({ runId, source: 'exchange', isValid: true }).lean(),
    Transaction.find({ runId, source: 'user', isValid: false }).lean(),
    Transaction.find({ runId, source: 'exchange', isValid: false }).lean(),
  ]);

  // Sort user txs chronologically so greedy assignment is deterministic
  validUserTxs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Index exchange txs by normalised asset; track which ones have been claimed
  const exchangeByAsset = {};
  for (const tx of validExchangeTxs) {
    if (!tx.normalizedAsset) continue;
    (exchangeByAsset[tx.normalizedAsset] ??= []).push(tx);
  }
  const claimedExchangeIds = new Set();

  const results = [];

  // ------------------------------------------------------------------
  // Match valid user transactions
  // ------------------------------------------------------------------
  for (const userTx of validUserTxs) {
    // Guard: we need asset, timestamp, and quantity to run matching
    if (!userTx.normalizedAsset || !userTx.timestamp || userTx.quantity === null) {
      results.push({
        runId,
        category: 'unmatched_user',
        userTransaction: userTx,
        exchangeTransaction: null,
        reason: 'Cannot match: normalised asset, timestamp, or quantity is missing',
        timeDiffSeconds: null,
        quantityDiffPct: null,
      });
      continue;
    }

    const candidates = (exchangeByAsset[userTx.normalizedAsset] ?? []).filter(
      (tx) => !claimedExchangeIds.has(tx._id.toString())
    );

    const result = findBestCandidate(userTx, candidates, tolerances);

    if (!result) {
      results.push({
        runId,
        category: 'unmatched_user',
        userTransaction: userTx,
        exchangeTransaction: null,
        reason: 'No matching exchange transaction found within tolerance',
        timeDiffSeconds: null,
        quantityDiffPct: null,
      });
      continue;
    }

    // Claim this exchange tx so no other user tx can match it
    claimedExchangeIds.add(result.tx._id.toString());

    if (result.outcome === 'matched') {
      results.push({
        runId,
        category: 'matched',
        userTransaction: userTx,
        exchangeTransaction: result.tx,
        reason: `Matched within tolerances (Δt=${result.timeDiff.toFixed(1)}s, Δqty=${result.qtyDiff.toFixed(4)}%)`,
        timeDiffSeconds: result.timeDiff,
        quantityDiffPct: result.qtyDiff,
      });
    } else {
      results.push({
        runId,
        category: 'conflicting',
        userTransaction: userTx,
        exchangeTransaction: result.tx,
        reason: buildConflictReason(result.timeDiff, result.qtyDiff, tolerances),
        timeDiffSeconds: result.timeDiff,
        quantityDiffPct: result.qtyDiff,
      });
    }
  }

  // ------------------------------------------------------------------
  // Unclaimed valid exchange transactions → unmatched_exchange
  // ------------------------------------------------------------------
  for (const excTx of validExchangeTxs) {
    if (!claimedExchangeIds.has(excTx._id.toString())) {
      results.push({
        runId,
        category: 'unmatched_exchange',
        userTransaction: null,
        exchangeTransaction: excTx,
        reason: 'No matching user transaction found',
        timeDiffSeconds: null,
        quantityDiffPct: null,
      });
    }
  }

  // ------------------------------------------------------------------
  // Flagged (invalid) transactions → unmatched with the data-quality reason
  // ------------------------------------------------------------------
  for (const tx of invalidUserTxs) {
    results.push({
      runId,
      category: 'unmatched_user',
      userTransaction: tx,
      exchangeTransaction: null,
      reason: `Flagged — data quality issues: ${tx.dataIssues.map((i) => i.issue).join('; ')}`,
      timeDiffSeconds: null,
      quantityDiffPct: null,
    });
  }

  for (const tx of invalidExchangeTxs) {
    results.push({
      runId,
      category: 'unmatched_exchange',
      userTransaction: null,
      exchangeTransaction: tx,
      reason: `Flagged — data quality issues: ${tx.dataIssues.map((i) => i.issue).join('; ')}`,
      timeDiffSeconds: null,
      quantityDiffPct: null,
    });
  }

  await ReconciliationResult.insertMany(results, { ordered: false });

  const summary = {
    matched: results.filter((r) => r.category === 'matched').length,
    conflicting: results.filter((r) => r.category === 'conflicting').length,
    unmatchedUser: results.filter((r) => r.category === 'unmatched_user').length,
    unmatchedExchange: results.filter((r) => r.category === 'unmatched_exchange').length,
  };

  logger.info('Matching complete', { runId, summary });
  return summary;
};

module.exports = { match };
