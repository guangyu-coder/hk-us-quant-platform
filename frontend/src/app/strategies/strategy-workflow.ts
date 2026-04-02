import { STRATEGY_PRESETS, type StrategyPresetKey } from '../../lib/strategy-form.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const RECENT_SYMBOLS_STORAGE_KEY = 'strategy-page:recent-symbols';
export const MAX_RECENT_SYMBOLS = 8;

export const COMMON_SYMBOL_SHORTCUTS = [
  'AAPL',
  'MSFT',
  'NVDA',
  'TSLA',
  'AMZN',
  'GOOGL',
  '0700.HK',
  '9988.HK',
] as const;

export const STRATEGY_TEMPLATE_SHORTCUTS = (
  Object.entries(STRATEGY_PRESETS) as Array<[StrategyPresetKey, (typeof STRATEGY_PRESETS)[StrategyPresetKey]]>
).map(([key, preset]) => ({
  key,
  label: preset.label,
  description: preset.description,
}));

const sanitizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const dedupeSymbols = (symbols: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const symbol of symbols) {
    const normalized = sanitizeSymbol(symbol);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

export const normalizeSymbolShortcut = sanitizeSymbol;

export const loadRecentSymbols = (storage: StorageLike | null | undefined) => {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(RECENT_SYMBOLS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return dedupeSymbols(parsed.filter((symbol): symbol is string => typeof symbol === 'string'));
  } catch {
    return [];
  }
};

export const saveRecentSymbols = (storage: StorageLike | null | undefined, symbols: string[]) => {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      RECENT_SYMBOLS_STORAGE_KEY,
      JSON.stringify(dedupeSymbols(symbols).slice(0, MAX_RECENT_SYMBOLS))
    );
  } catch {
    // Local storage is best-effort only.
  }
};

export const upsertRecentSymbol = (symbols: string[], symbol: string) => {
  const normalized = sanitizeSymbol(symbol);
  if (!normalized) {
    return dedupeSymbols(symbols);
  }

  return dedupeSymbols([normalized, ...symbols]).slice(0, MAX_RECENT_SYMBOLS);
};
