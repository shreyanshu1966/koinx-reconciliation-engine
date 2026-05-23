const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../utils/logger');

const connect = async () => {
  await mongoose.connect(config.mongoUri);
  logger.info('MongoDB connected', { uri: config.mongoUri });
};

const disconnect = async () => {
  await mongoose.disconnect();
};

module.exports = { connect, disconnect };
