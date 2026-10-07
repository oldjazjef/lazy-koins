import { type ToolContext, TOOL_SOURCES, type ToolSource } from './tool';

/**
 * User scoping of the tool layer (F11.16 "nur die eigenen Daten"): who a tool acts for comes
 * ONLY from the authenticated request — the chat's session or the MCP personal access token —
 * never from tool arguments, headers, MCP `_meta`, resource URIs or session ids.
 *
 * - `toolContext` builds the one immutable `ToolContext` every tool receives;
 * - tool input schemas must not have a field that names a user (`assertNoIdentityFields`, checked
 *   when the registry is built and by `tool-scoping.spec.ts`);
 * - arguments that try to name one anyway are refused (`identityArguments`).
 */

/**
 * Field names that would let a caller say *whose* data a tool should touch: `user`, `owner`,
 * `tenant`, `principal`, `accountHolder` (alone or with an id/e-mail/name suffix), actor /
 * subject / identity / creator / member **ids**, bare `uid`, `onBehalfOf`, `asUser`,
 * `impersonate`. Compared case-insensitively with `_`, `-` and spaces removed. A mail's
 * `subject` and `accountId` (an exchange account inside the user's own data) are not identities.
 */
const IDENTITY_FIELD =
  /^(?:(?:user|owner|tenant|principal|accountholder)(?:id|ids|uid|email|mail|name)?|(?:actor|subject|identity|creator|member)(?:id|ids|uid|email)|uid|onbehalfof|asuser|impersonate)$/;

export function isIdentityField(name: string): boolean {
  return IDENTITY_FIELD.test(name.replace(/[-_\s]/g, '').toLowerCase());
}

/** Every property path of a JSON Schema whose name is an identity field. */
export function identityFieldsOf(schema: unknown, path = ''): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const node = schema as Record<string, unknown>;
  const found: string[] = [];
  const properties = node['properties'];
  if (properties && typeof properties === 'object') {
    for (const [key, child] of Object.entries(
      properties as Record<string, unknown>,
    )) {
      const at = path ? `${path}.${key}` : key;
      if (isIdentityField(key)) found.push(at);
      found.push(...identityFieldsOf(child, at));
    }
  }
  for (const key of ['items', 'additionalProperties', 'not']) {
    found.push(...identityFieldsOf(node[key], `${path}[]`));
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    const list = node[key];
    if (Array.isArray(list)) {
      for (const child of list) found.push(...identityFieldsOf(child, path));
    }
  }
  for (const key of ['$defs', 'definitions']) {
    const defs = node[key];
    if (defs && typeof defs === 'object') {
      for (const child of Object.values(defs as Record<string, unknown>)) {
        found.push(...identityFieldsOf(child, path));
      }
    }
  }
  return found;
}

/** Top-level argument names that try to name a user (refused before the tool runs). */
export function identityArguments(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  return Object.keys(args).filter(isIdentityField);
}

/**
 * The immutable context of one tool call, built from the authentication result only. Throws on
 * anything that is not a non-empty user id and a known source — a programming error, never a
 * user input.
 */
export function toolContext(input: {
  readonly userId: string;
  readonly source: ToolSource;
  readonly tokenId?: string | null;
}): ToolContext {
  if (typeof input.userId !== 'string' || input.userId.trim() === '') {
    throw new Error('A tool call needs the authenticated user id');
  }
  if (!(TOOL_SOURCES as readonly string[]).includes(input.source)) {
    throw new Error(`Unknown tool source: ${String(input.source)}`);
  }
  return Object.freeze({
    userId: input.userId,
    source: input.source,
    ...(typeof input.tokenId === 'string' ? { tokenId: input.tokenId } : {}),
  });
}
