const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ReconciliationRun = require('../models/ReconciliationRun');
const ReconciliationResult = require('../models/ReconciliationResult');
const { ingest } = require('../services/ingestion.service');
const { match } = require('../services/matcher.service');
const { generateCsvReport, getFullReport, getUnmatchedReport } = require('../services/report.service');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helper: parse and validate tolerance overrides from request body
// ---------------------------------------------------------------------------
const parseTolerances = (body) => {
  const defaults = config.matching;
  const tolerances = {
    timestampToleranceSeconds: defaults.timestampToleranceSeconds,
    quantityTolerancePct: defaults.quantityTolerancePct,
  };

  if (body.timestampToleranceSeconds !== undefined) {
    const val = parseFloat(body.timestampToleranceSeconds);
    if (isNaN(val) || val < 0) {
      throw new Error('timestampToleranceSeconds must be a non-negative number');
    }
    tolerances.timestampToleranceSeconds = val;
  }

  if (body.quantityTolerancePct !== undefined) {
    const val = parseFloat(body.quantityTolerancePct);
    if (isNaN(val) || val < 0) {
      throw new Error('quantityTolerancePct must be a non-negative number');
    }
    tolerances.quantityTolerancePct = val;
  }

  return tolerances;
};

// ---------------------------------------------------------------------------
// POST /reconcile
// Triggers a full reconciliation run. Accepts optional tolerance overrides.
// ---------------------------------------------------------------------------
router.post('/reconcile', async (req, res, next) => {
  let tolerances;
  try {
    tolerances = parseTolerances(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const runId = uuidv4();

  const run = await ReconciliationRun.create({
    runId,
    status: 'running',
    config: tolerances,
  });

  // Run the pipeline asynchronously so the response returns the runId immediately,
  // but also await it here to keep error propagation simple for this assignment.
  try {
    logger.info('Reconciliation run started', { runId, tolerances });

    const ingestionStats = await ingest(
      config.userTransactionsFile,
      config.exchangeTransactionsFile,
      runId
    );

    const matchSummary = await match(runId, tolerances);
    const reportPath = await generateCsvReport(runId);

    const summary = {
      ...ingestionStats,
      ...matchSummary,
    };

    await ReconciliationRun.updateOne(
      { runId },
      {
        status: 'completed',
        summary,
        reportPath: path.relative(process.cwd(), reportPath),
      }
    );

    logger.info('Reconciliation run completed', { runId, summary });

    return res.status(201).json({
      runId,
      status: 'completed',
      config: tolerances,
      summary,
      reportPath: path.relative(process.cwd(), reportPath),
    });
  } catch (err) {
    logger.error('Reconciliation run failed', { runId, error: err.message });
    await ReconciliationRun.updateOne({ runId }, { status: 'failed', error: err.message });
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /report/:runId
// Returns the full reconciliation report. Append ?format=csv to download the
// generated CSV file instead of receiving JSON.
// ---------------------------------------------------------------------------
router.get('/report/:runId', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) return res.status(404).json({ error: `Run ${runId} not found` });

    if (req.query.format === 'csv') {
      if (!run.reportPath) {
        return res.status(404).json({ error: 'CSV report not yet generated for this run' });
      }
      const absolutePath = path.resolve(run.reportPath);
      return res.download(absolutePath, `reconciliation_${runId}.csv`);
    }

    const results = await getFullReport(runId);
    return res.json({ runId, status: run.status, config: run.config, results });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /report/:runId/summary
// Returns only the aggregate counts for a run.
// ---------------------------------------------------------------------------
router.get('/report/:runId/summary', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) return res.status(404).json({ error: `Run ${runId} not found` });

    return res.json({
      runId,
      status: run.status,
      config: run.config,
      summary: run.summary,
      createdAt: run.createdAt,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /report/:runId/unmatched
// Returns only unmatched rows (user-only and exchange-only) with reasons.
// ---------------------------------------------------------------------------
router.get('/report/:runId/unmatched', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) return res.status(404).json({ error: `Run ${runId} not found` });

    const unmatched = await getUnmatchedReport(runId);
    return res.json({ runId, count: unmatched.length, unmatched });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
