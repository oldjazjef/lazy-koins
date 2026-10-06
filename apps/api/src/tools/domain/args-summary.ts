import { detectSecret } from '@lazykoins/engine';
import { redactSecrets } from '../../integrations/ai/redact';

/** Longest argument summary an audit row keeps (the column's CHECK allows 2000). */
export const MAX_ARGS_SUMMARY = 500;

/** Names whose values are never written down: keys, tokens, passwords. */
const SECRET_NAME =
  /(^(key|token|seed|pin)$)|api_?key|secret|password|passwd|mnemonic|private_?key|authorization|cipher|access_?token|seed_?phrase/i;
/** Names whose values are bulk data (an upload, a mail body): only their size is kept. */
const BULK_NAME = /^(content|contentBase64|bytes|body|text|spec)$/i;

const LONG_TEXT = 120;

/**
 * The audit's picture of a tool call's arguments (F11.14/F11.16, "Jeder Aufruf wird
 * protokolliert"): structure and short values only. Secret-named fields, anything that looks
 * like a seed phrase or private key (`detectSecret`, F6.2) and credential patterns
 * (`redactSecrets`) are replaced; long texts and bulk fields shrink to their length.
 */
export function summarizeArgs(args: unknown): string {
  const text = JSON.stringify(shrink(args, 0)) ?? '';
  return redactSecrets(text).slice(0, MAX_ARGS_SUMMARY);
}

function shrink(value: unknown, depth: number, name = ''): unknown {
  if (name && SECRET_NAME.test(name)) return '[redacted]';
  if (typeof value === 'string') {
    if (detectSecret(value)) return '[redacted]';
    if (name && BULK_NAME.test(name)) return `<${value.length} chars>`;
    return value.length > LONG_TEXT
      ? `${value.slice(0, 60)}… (${value.length} chars)`
      : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 3) return Array.isArray(value) ? '[…]' : '{…}';
  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map((item) => shrink(item, depth + 1));
    return value.length > 10 ? [...items, `… +${value.length - 10}`] : items;
  }
  if (name && BULK_NAME.test(name)) return '{…}';
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
      key,
      shrink(inner, depth + 1, key),
    ]),
  );
}
