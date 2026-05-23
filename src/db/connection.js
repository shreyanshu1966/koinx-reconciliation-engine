const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../utils/logger');

const connect = async () => {
  await mongoose.connect(config.mongoUri);
  const safeUri = config.mongoUri.replace(/:\/\/[^@]+@/, '://***:***@');
  logger.info('MongoDB connected', { uri: safeUri });
};

const disconnect = async () => {
  await mongoose.disconnect();
};

module.exports = { connect, disconnect };
