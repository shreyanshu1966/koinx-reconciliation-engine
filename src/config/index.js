const path = require('path');

// Resolve the project root regardless of the working directory the process
// was started from (e.g. npm start run inside a subdirectory).
const PROJECT_ROOT = path.resolve(__dirname, '../../');

require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

const resolvePath = (envValue, fallback) =>
  path.resolve(PROJECT_ROOT, envValue || fallback);

module.exports = {
  port: parseInt(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/koinx_reconciliation',
  userTransactionsFile: resolvePath(process.env.USER_TRANSACTIONS_FILE, 'data/user_transactions.csv'),
  exchangeTransactionsFile: resolvePath(process.env.EXCHANGE_TRANSACTIONS_FILE, 'data/exchange_transactions.csv'),
  reportsDir: resolvePath(process.env.REPORTS_DIR, 'reports'),
  matching: {
    timestampToleranceSeconds: parseFloat(process.env.TIMESTAMP_TOLERANCE_SECONDS) || 300,
    quantityTolerancePct: parseFloat(process.env.QUANTITY_TOLERANCE_PCT) || 0.01,
  },
};
