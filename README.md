# KoinX — Transaction Reconciliation Engine

A production-grade Node.js service that ingests two CSV exports of the same crypto account (one from the user, one from the exchange), matches transactions across them with configurable tolerances, and produces a structured reconciliation report.

**Live API:** `https://koinx-reconciliation-engine-production.up.railway.app`

> Quick test: `POST https://koinx-reconciliation-engine-production.up.railway.app/reconcile`

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 |
| Framework | Express 4 |
| Database | MongoDB (via Mongoose 8) |
| CSV parsing | csv-parse 5 |

---

## Setup

### Prerequisites

- Node.js ≥ 18
- A running MongoDB instance (default: `mongodb://localhost:27017`)

### Install

```bash
git clone <repo-url>
cd koinx-reconciliation-engine
npm install
```

### Configure

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

Key environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MONGO_URI` | `mongodb://localhost:27017/koinx_reconciliation` | MongoDB connection string |
| `USER_TRANSACTIONS_FILE` | `./data/user_transactions.csv` | Path to user CSV |
| `EXCHANGE_TRANSACTIONS_FILE` | `./data/exchange_transactions.csv` | Path to exchange CSV |
| `REPORTS_DIR` | `./reports` | Directory for generated CSV reports |
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Max timestamp delta for a match (seconds) |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Max quantity delta for a match (percentage) |

### Run

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

---

## API Reference

### `POST /reconcile`

Triggers a reconciliation run. Tolerance values from the request body override environment defaults for that run only.

**Request body (all fields optional):**
```json
{
  "timestampToleranceSeconds": 300,
  "quantityTolerancePct": 0.01
}
```

**Response `201`:**
```json
{
  "runId": "uuid-v4",
  "status": "completed",
  "config": { "timestampToleranceSeconds": 300, "quantityTolerancePct": 0.01 },
  "summary": {
    "totalUser": 25,
    "totalExchange": 25,
    "validUser": 21,
    "validExchange": 25,
    "flaggedUser": 4,
    "flaggedExchange": 0,
    "matched": 20,
    "conflicting": 1,
    "unmatchedUser": 4,
    "unmatchedExchange": 3
  },
  "reportPath": "reports/reconciliation_<runId>.csv"
}
```

---

### `GET /report/:runId`

Returns the full reconciliation report as JSON.

Append `?format=csv` to download the CSV file directly.

---

### `GET /report/:runId/summary`

Returns only the aggregate counts for a run (fast, no per-row data).

---

### `GET /report/:runId/unmatched`

Returns only `unmatched_user` and `unmatched_exchange` rows with their reasons.

---

## CSV Report Format

Each row in the generated report file contains:

| Column | Description |
|---|---|
| `category` | `matched` / `conflicting` / `unmatched_user` / `unmatched_exchange` |
| `reason` | Human-readable explanation of the categorisation |
| `time_diff_seconds` | Absolute timestamp difference (blank for unmatched) |
| `quantity_diff_pct` | Absolute quantity difference in % (blank for unmatched) |
| `user_*` | All fields from the user-side transaction |
| `exchange_*` | All fields from the exchange-side transaction |

---

## Key Design Decisions

### 1. Greedy matching algorithm

Transactions are sorted by timestamp and matched left-to-right: for each user transaction the engine picks the best available exchange candidate (lowest timestamp delta). Once claimed, an exchange transaction cannot be re-used. This is O(n·m) per asset group — adequate for the data volumes described. A globally-optimal assignment (Hungarian algorithm) would reduce false conflicts when multiple candidates score similarly, but adds significant complexity that is not warranted here.

### 2. Conflict detection window (2× tolerance)

A transaction pair is labelled **conflicting** when the two sides have matching asset and compatible type, the timestamp delta is within **2×** `TIMESTAMP_TOLERANCE_SECONDS`, but either the timestamp or the quantity falls outside the primary tolerance. The 2× multiplier catches events just beyond the tolerance boundary that are almost certainly the same transaction but with slightly off data.

### 3. TRANSFER_IN / TRANSFER_OUT perspective mapping

A withdrawal on the user's side (`TRANSFER_OUT`) and the corresponding deposit on the exchange side (`TRANSFER_IN`) represent the same on-chain event. The type mapper treats these as compatible for matching purposes. This is a deliberate one-way/two-way mapping — both directions are supported.

### 4. Asset alias normalisation

Common full names (e.g. `bitcoin`, `ethereum`, `solana`) are normalised to their canonical tickers before matching. Matching is case-insensitive. The alias table in `src/utils/assetNormalizer.js` is the single source of truth for all supported aliases.

### 5. Invalid rows are flagged, not dropped

Rows with missing timestamps, negative quantities, duplicate IDs, or other structural errors are stored in MongoDB with `isValid: false` and appear in the final report as `unmatched_user` / `unmatched_exchange` with the specific data-quality reason attached. No row is silently discarded.

### 6. Per-run ingestion

Each call to `POST /reconcile` re-ingests the CSV files for that run. This ensures the latest file state is always used, and each run is a fully self-contained audit trail in the database. At larger scale, ingestion would be decoupled (e.g. triggered by file upload) to avoid reprocessing unchanged data.

### 7. Configuration without code changes

All matching tolerances are read from environment variables at startup and can be overridden per-request via the `POST /reconcile` body. No code change or restart is required to experiment with different tolerance settings.

### 8. Quantity tolerance interpretation

`QUANTITY_TOLERANCE_PCT=0.01` means **0.01 percent** (not 1%). This is intentionally tight — at crypto scale even a 0.03% rounding difference (e.g. `0.3` vs `0.3001 BTC`) is a material discrepancy that should be surfaced for review. The caller can widen the tolerance at request time if needed.
