/**
 * Transactions that represent the same on-chain event but are recorded from
 * opposite perspectives (user vs exchange) must be treated as compatible.
 * Each key maps to its counterpart type.
 */
const PERSPECTIVE_PAIRS = {
  TRANSFER_OUT: 'TRANSFER_IN',
  TRANSFER_IN: 'TRANSFER_OUT',
};

const normalizeType = (type) => {
  if (!type || typeof type !== 'string') return null;
  return type.trim().toUpperCase();
};

/**
 * Returns true when two transaction types can represent the same real event.
 * Handles both exact matches and cross-perspective pairs.
 */
const areTypesCompatible = (typeA, typeB) => {
  if (!typeA || !typeB) return false;
  const a = normalizeType(typeA);
  const b = normalizeType(typeB);
  return a === b || PERSPECTIVE_PAIRS[a] === b;
};

module.exports = { normalizeType, areTypesCompatible };
