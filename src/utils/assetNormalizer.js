/**
 * Maps common human-readable or alternative asset names to their canonical ticker.
 * Keys are lowercase; values are the canonical uppercase ticker.
 */
const ASSET_ALIASES = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  polygon: 'MATIC',
  chainlink: 'LINK',
  tether: 'USDT',
  'usd coin': 'USDC',
  binancecoin: 'BNB',
  ripple: 'XRP',
  cardano: 'ADA',
  dogecoin: 'DOGE',
  avalanche: 'AVAX',
};

/**
 * Returns the canonical uppercase ticker for an asset string.
 * Falls back to the uppercased input if no alias is found.
 */
const normalizeAsset = (asset) => {
  if (!asset || typeof asset !== 'string') return null;
  const trimmed = asset.trim();
  const lower = trimmed.toLowerCase();
  return ASSET_ALIASES[lower] ?? trimmed.toUpperCase();
};

module.exports = { normalizeAsset };
