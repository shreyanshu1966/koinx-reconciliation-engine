const express = require('express');
const cors = require('cors');
const { connect } = require('./db/connection');
const reconcileRoutes = require('./routes/reconcile.routes');
const errorHandler = require('./middlewares/errorHandler');
const config = require('./config');
const logger = require('./utils/logger');

const app = express();

app.use(cors());
app.use(express.json());

// Health-check — useful for container / CI environments
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/', reconcileRoutes);

app.use(errorHandler);

const start = async () => {
  await connect();
  app.listen(config.port, '0.0.0.0', () => {
    logger.info('Server listening', { port: config.port });
  });
};

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});

module.exports = app;
