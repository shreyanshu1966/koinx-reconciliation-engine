const log = (level, message, meta = {}) => {
  const entry = { level, message, timestamp: new Date().toISOString(), ...meta };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
};

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
