import { detectSecret } from '../wallets/secrets';

/**
 * Mapping library (F5.15): before a mapping becomes public, its JSON is scanned for values that
 * may identify a person — filter values, asset aliases, constants (account, evidence), the
 * file-name pattern and the free texts. A finding names the JSON path, the kind and the value
 * (shown to the author only, never stored). Most can be removed (`removePrivacyFindings`); the
 * rest (the name, a side column's values) the author edits in the mapping itself.
 *
 * Pure and deterministic; heuristics on purpose — a warning the author reviews, not a verdict.
 */
export const PRIVACY_FINDING_KINDS = [
  'email',
  'iban',
  'walletAddress',
  'accountId',
  'personName',
  'secret',
] as const;
export type PrivacyFindingKind = (typeof PRIVACY_FINDING_KINDS)[number];

export interface PrivacyFinding {
  /** JSON Pointer into the spec (`/filters/0/equals/1`, `/assets/aliases/ABC`). */
  readonly path: string;
  readonly kind: PrivacyFindingKind;
  /** The value as written in the spec. Never logged or stored. */
  readonly value: string;
  /** `removePrivacyFindings` can drop it without breaking the spec. */
  readonly removable: boolean;
}

/** Keys whose strings are structure (column names, enums, formats) — never personal data. */
const STRUCTURAL_KEYS = new Set([
  'format',
  'platform',
  'column',
  'inColumn',
  'outColumn',
  'sideColumn',
  'assetColumn',
  'timeZone',
  'delimiter',
  'encoding',
  'decimal',
  'mode',
  'kind',
  'default',
  'sheet',
  'headers',
  'columns',
  'thousands',
]);

/** Filter columns that typically hold a person's name. */
const NAME_COLUMN =
  /name|owner|holder|inhaber|kunde|customer|client|empf|recipient|sender|absender|beneficiary|beg[uü]nstigt/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
const EVM_ADDRESS = /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-zA-Z])/;
const BECH32_ADDRESS =
  /(?<![0-9a-zA-Z])(?:bc1|tb1|ltc1)[02-9ac-hj-np-z]{11,71}(?![0-9a-zA-Z])/i;
const BASE58_RUN =
  /(?<![0-9A-Za-z])[1-9A-HJ-NP-Za-km-z]{25,44}(?![0-9A-Za-z])/g;
const IBAN_CANDIDATE =
  /(?<![A-Z0-9])[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}(?![A-Z0-9])/gi;
const LONG_DIGITS = /\d{6,}/;
const PERSON_NAME =
  /^\s*[A-ZÄÖÜÉÈÀ][a-zäöüéèàçß'’]+(?:[ -](?:von |van |de |di |da )?[A-ZÄÖÜÉÈÀ][a-zäöüéèàçß'’]+)+\s*$/;

/** ISO 13616 check digits (mod 97). */
function validIban(text: string): boolean {
  const iban = text.replace(/\s+/g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const digits =
      code >= 65 && code <= 90
        ? String(code - 55)
        : /\d/.test(char)
          ? char
          : '';
    if (digits === '') return false;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** A token of ≥ 8 letters/digits with ≥ 4 digits and a letter ("AB1234567", "U-2024-0001"). */
function mixedId(text: string): boolean {
  return text
    .split(/[^0-9A-Za-z-]+/)
    .some(
      (token) =>
        token.length >= 8 &&
        !/^\d{4}-\d{2}-\d{2}/.test(token) &&
        /[A-Za-z]/.test(token) &&
        (token.match(/\d/g) ?? []).length >= 4,
    );
}

function base58Address(text: string): boolean {
  for (const match of text.matchAll(BASE58_RUN)) {
    const token = match[0];
    // An address mixes digits, upper and lower case; a word or an all-caps ticker does not.
    if (/\d/.test(token) && /[A-Z]/.test(token) && /[a-z]/.test(token)) {
      return true;
    }
  }
  return false;
}

/** What a single string looks like, or null. `nameLike` = also check for a person's name. */
export function classifyPrivateValue(
  text: string,
  nameLike = false,
): PrivacyFindingKind | null {
  if (text.trim() === '') return null;
  if (detectSecret(text)) return 'secret';
  if (EMAIL.test(text)) return 'email';
  for (const match of text.matchAll(IBAN_CANDIDATE)) {
    if (validIban(match[0])) return 'iban';
  }
  if (
    EVM_ADDRESS.test(text) ||
    BECH32_ADDRESS.test(text) ||
    base58Address(text)
  ) {
    return 'walletAddress';
  }
  if (LONG_DIGITS.test(text.replace(/\\d\{\d+(,\d+)?\}/g, ''))) {
    return 'accountId';
  }
  if (mixedId(text)) return 'accountId';
  if (nameLike && PERSON_NAME.test(text)) return 'personName';
  return null;
}

function pointer(path: readonly (string | number)[]): string {
  return path
    .map((part) => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

function parsePointer(text: string): string[] {
  if (!text.startsWith('/')) return [];
  return text
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Is a finding at this path removable without breaking the spec? */
function removableAt(path: readonly (string | number)[]): boolean {
  const [first, second, third, fourth] = path;
  if (first === 'description') return true;
  if (first === 'match' && second === 'fileName') return true;
  if (first === 'filters') return true;
  if (first === 'assets' && (second === 'aliases' || second === 'rewrites')) {
    return true;
  }
  if (
    (first === 'bookings' || first === 'holdings') &&
    (second === 'account' || second === 'evidence') &&
    third === 'value'
  ) {
    return true;
  }
  if (first === 'bookings' && second === 'kind' && third === 'rules') {
    return fourth !== undefined;
  }
  return false;
}

/** Does this path take a person's name heuristic (constants, filters on a name column)? */
function nameLikeAt(
  spec: Record<string, unknown>,
  path: readonly (string | number)[],
): boolean {
  const [first, second, third] = path;
  if (
    (first === 'bookings' || first === 'holdings') &&
    (second === 'account' || second === 'evidence') &&
    third === 'value'
  ) {
    return true;
  }
  if (first === 'filters' && typeof second === 'number') {
    const filters = spec['filters'];
    const filter = Array.isArray(filters) ? filters[second] : undefined;
    const column = isRecord(filter) ? filter['column'] : undefined;
    return typeof column === 'string' && NAME_COLUMN.test(column);
  }
  return false;
}

/**
 * Every value of the spec that looks like personal data. Alias keys are checked as well as their
 * values (an alias can rename an account number). Order: document order.
 */
export function scanMappingPrivacy(spec: unknown): PrivacyFinding[] {
  if (!isRecord(spec)) return [];
  const findings: PrivacyFinding[] = [];
  const visit = (value: unknown, path: (string | number)[]): void => {
    const last = path[path.length - 1];
    if (typeof last === 'string' && STRUCTURAL_KEYS.has(last)) return;
    if (typeof value === 'string') {
      const kind = classifyPrivateValue(value, nameLikeAt(spec, path));
      if (kind) {
        findings.push({
          path: pointer(path),
          kind,
          value,
          removable: removableAt(path),
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (isRecord(value)) {
      const aliases =
        path.length === 2 && path[0] === 'assets' && path[1] === 'aliases';
      for (const [key, item] of Object.entries(value)) {
        if (aliases) {
          const kind =
            classifyPrivateValue(key) ??
            (typeof item === 'string' ? classifyPrivateValue(item) : null);
          if (kind) {
            findings.push({
              path: pointer([...path, key]),
              kind,
              value: typeof item === 'string' ? `${key} → ${item}` : key,
              removable: true,
            });
          }
          continue;
        }
        visit(item, [...path, key]);
      }
    }
  };
  visit(spec, []);
  return findings;
}

const REMOVED = Symbol('removed');

function setAt(root: unknown, path: readonly string[], value: unknown): void {
  let node: unknown = root;
  for (const part of path.slice(0, -1)) {
    if (Array.isArray(node)) node = node[Number(part)];
    else if (isRecord(node)) node = node[part];
    else return;
  }
  const last = path[path.length - 1];
  if (last === undefined) return;
  if (Array.isArray(node)) {
    const index = Number(last);
    if (Number.isInteger(index) && index >= 0 && index < node.length) {
      node[index] = value;
    }
  } else if (isRecord(node) && last in node) {
    node[last] = value;
  }
}

function sweep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== REMOVED).map(sweep);
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== REMOVED) out[key] = sweep(item);
    }
    return out;
  }
  return value;
}

/**
 * The spec without the findings at `paths` (only removable ones; others are ignored):
 * a filter value goes (and the filter, when nothing is left to match), an alias or rewrite goes
 * whole, a constant goes (and its source, when it had no column), a kind rule goes whole, the
 * description and the file-name pattern go. Returns a new object; the input is not changed.
 */
export function removePrivacyFindings(
  spec: unknown,
  paths: readonly string[],
): unknown {
  if (!isRecord(spec)) return spec;
  const copy = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
  for (const text of paths) {
    const path = parsePointer(text);
    const numeric = path.map((part) =>
      /^\d+$/.test(part) ? Number(part) : part,
    );
    if (path.length === 0 || !removableAt(numeric)) continue;
    const [first, second, third, fourth] = path;
    if (first === 'filters' && second !== undefined) {
      // A value of `equals` or the pattern; the whole filter when the path is shorter.
      setAt(
        copy,
        third === 'equals' && fourth !== undefined
          ? path.slice(0, 4)
          : third === 'pattern'
            ? path.slice(0, 3)
            : path.slice(0, 2),
        REMOVED,
      );
    } else if (first === 'assets' && second === 'rewrites') {
      setAt(copy, path.slice(0, 3), REMOVED);
    } else if (first === 'assets' && second === 'aliases') {
      setAt(copy, path.slice(0, 3), REMOVED);
    } else if (first === 'bookings' && second === 'kind') {
      setAt(copy, path.slice(0, 4), REMOVED);
    } else {
      setAt(copy, path, REMOVED);
    }
  }
  const swept = sweep(copy) as Record<string, unknown>;
  // Filters with nothing left to match go; an empty `equals` matches nothing and goes too.
  if (Array.isArray(swept['filters'])) {
    swept['filters'] = (swept['filters'] as unknown[]).filter((filter) => {
      if (!isRecord(filter)) return false;
      if (Array.isArray(filter['equals']) && filter['equals'].length === 0) {
        delete filter['equals'];
      }
      return (
        filter['equals'] !== undefined ||
        filter['pattern'] !== undefined ||
        filter['empty'] !== undefined
      );
    });
  }
  // A constant source without a column and without its value is no source any more.
  for (const section of ['bookings', 'holdings']) {
    const block = swept[section];
    if (!isRecord(block)) continue;
    for (const key of ['account', 'evidence']) {
      const source = block[key];
      if (
        isRecord(source) &&
        source['column'] === undefined &&
        source['value'] === undefined
      ) {
        delete block[key];
      }
    }
  }
  return swept;
}
