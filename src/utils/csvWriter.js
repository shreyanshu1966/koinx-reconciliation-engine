/**
 * Minimal CSV serialiser — no external dependencies.
 * Follows RFC 4180: fields containing commas, quotes, or newlines are
 * wrapped in double-quotes; embedded double-quotes are doubled.
 */
const escape = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const rowToLine = (values) => values.map(escape).join(',');

/**
 * Converts an array of objects to a CSV string.
 * @param {string[]} headers - Column names (in order)
 * @param {Function} rowMapper - (item) => string[] mapping an object to column values
 * @param {Array} items
 * @returns {string} Full CSV text including header line
 */
const toCsv = (headers, rowMapper, items) => {
  const lines = [rowToLine(headers)];
  for (const item of items) {
    lines.push(rowToLine(rowMapper(item)));
  }
  return lines.join('\n');
};

module.exports = { toCsv };
