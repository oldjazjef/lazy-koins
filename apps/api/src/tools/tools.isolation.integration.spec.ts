import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AssistantSettingsRepositoryPort } from '../assistant/ports/assistant.repository.port';
import type { ChatRepositoryPort } from '../assistant/ports/assistant.repository.port';
import type { MailService } from '../mail/mail.service';
import type { McpService } from '../mcp/mcp.service';
import type { NotificationService } from '../notifications/application/notification.service';
import type { ToolExecutor } from './application/tool-executor';
import type { McpToolPolicy } from './application/tool-registry';
import type { AnyTool, ToolContext, ToolSource } from './domain/tool';
import { availableIn, TOOL_AREAS } from './domain/tool';
import type { ToolAuditRepositoryPort } from './ports/tool-audit.repository.port';

/**
 * F11.16 — "MCP (and the chat's tool layer) acts ONLY for the authenticated user".
 *
 * The whole API (AppModule) against the real SQLite test database. Two users, A and B, each with
 * a full set of data — project, files (the SAME bytes, so the same SHA-256), a mapping with the
 * SAME fingerprint, a wallet in the project, a calculation, a correction, an export, a
 * notification, a chat conversation with a pending proposal, MCP settings and a personal access
 * token. Then, as B:
 *
 * 1. **every tool of the registry** is called with A's ids (`CASES` — a tool without a case fails
 *    the suite, so a new tool must say how it is attacked) on every channel it exists on: it must
 *    fail (404 / refused), and nothing B sees may contain A's data;
 * 2. the list / create tools (no foreign id possible) return none of A's items;
 * 3. the chat's proposal previews, the conversations, notifications, tokens and the audit log
 *    over HTTP with B's sign-in;
 * 4. MCP end to end with the SDK client and B's PAT: tools, resources, `_meta`, identity
 *    arguments, PAT on other routes, dev token on MCP;
 * 5. afterwards A's data — read as A — is exactly what it was.
 *
 * Run with `pnpm ci:integration` (never against your dev database).
 */

const KRAKEN_SPEC: unknown = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../../../libs/engine/src/mapping/fixtures/kraken-ledger.mapping.json',
    ),
    'utf8',
  ),
);
const KRAKEN_CSV = readFileSync(
  resolve(
    __dirname,
    '../../../../libs/engine/src/mapping/fixtures/kraken-ledger-classic.csv',
  ),
);
const BOOKINGS_CSV = [
  'Zeitpunkt,Plattform,Konto,Art,Asset,Menge,Gebühr,Gebühr-Asset,Preis CHF,Preis USD,Referenz,Notiz',
  '2025-01-03T10:00:00Z,kraken,spot,deposit,CHF,1000,,,,,,',
  '2025-01-03T11:00:00Z,kraken,spot,trade,CHF,-500,1.3,,,,T1,',
  '2025-01-03T11:00:00Z,kraken,spot,trade,BTC,0.005,,,,,T1,',
  '2025-03-01T00:00:00Z,kraken,spot,income_staking,DOT,2,0.5,,,5,,',
].join('\n');

const FULL_POLICY: McpToolPolicy = { areas: [...TOOL_AREAS], allowWrite: true };
const base64 = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString('base64');

interface Seeded {
  readonly tag: string;
  readonly email: string;
  readonly userId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly mappingId: string;
  /** The user's own entry in the public mapping library (F5.15). */
  readonly libraryId: string;
  readonly fileIds: readonly string[];
  readonly krakenFileId: string;
  readonly walletId: string;
  readonly walletLabel: string;
  readonly walletAddress: string;
  readonly correctionId: string;
  /** F9.8: a global edit of one of A's transactions, and that transaction's key. */
  readonly transactionEditId: string;
  readonly transactionKey: string;
  readonly exportId: string;
  readonly figureId: string;
  readonly openItemKey: string;
  readonly conversationId: string;
  readonly proposalId: string;
  readonly tokenId: string;
  readonly token: string;
  readonly advisorName: string;
}

let app: INestApplication;
let api = '';
let executor: ToolExecutor;
let A: Seeded;
let B: Seeded;
/** What B must never see: A's names and data (ids are checked where B did not type them). */
let aData: string[] = [];
/** A's ids — absent from everything B lists or creates. */
let aIds: string[] = [];

async function http(
  method: string,
  path: string,
  bearer: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep the text
  }
  return { status: response.status, body: parsed };
}

const dev = (user: { email: string }) => `dev:${user.email}`;

function context(userId: string, source: ToolSource = 'mcp'): ToolContext {
  return { userId, source };
}

/** Runs a tool and insists it worked (seeding). */
async function must<T = Record<string, unknown>>(
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await executor.call(context(userId), name, args, {
    policy: FULL_POLICY,
  });
  if (!result.ok) {
    throw new Error(`${name} failed while seeding: ${JSON.stringify(result)}`);
  }
  return result.output as T;
}

async function seed(tag: string, address: string): Promise<Seeded> {
  const email = `${tag.toLowerCase()}-${randomUUID().slice(0, 8)}@isolation.test`;
  const me = await http('GET', '/me', `dev:${email}`);
  expect(me.status).toBe(200);
  const userId = (me.body as { id: string }).id;

  const mcp = app.get<McpService>(
    (await import('../mcp/mcp.service')).McpService,
  );
  await mcp.saveSettings(userId, {
    enabled: true,
    areas: [...TOOL_AREAS],
    allowWrite: true,
  });
  const created = await mcp.createToken(userId, `Isolation ${tag}`, 30);

  const advisorName = `Treuhand ${tag} ${randomUUID().slice(0, 6)}`;
  await must(userId, 'update_settings', {
    displayName: `${tag} Isolation`,
    advisorName,
    advisorEmail: `${tag.toLowerCase()}-advisor@isolation.test`,
  });
  const mail = app.get<MailService>(
    (await import('../mail/mail.service')).MailService,
  );
  await mail.saveSettings(userId, {
    enabled: true,
    // Nothing listens there: a send that got that far would fail, never deliver.
    host: '127.0.0.1',
    port: 9,
    security: 'none',
    username: '',
    fromName: tag,
    fromAddress: `${tag.toLowerCase()}@isolation.test`,
  });

  const projectName = `Iso ${tag} ${randomUUID().slice(0, 6)}`;
  const project = await must<{ id: string }>(userId, 'create_project', {
    name: projectName,
    taxYear: 2025,
    canton: 'ZH',
  });
  const mapping = await must<{ id: string }>(userId, 'create_mapping', {
    spec: KRAKEN_SPEC,
  });
  const kraken = await must<{ id: string; mappingId: string | null }>(
    userId,
    'upload_file',
    {
      projectId: project.id,
      name: 'kraken-ledger.csv',
      contentBase64: base64(KRAKEN_CSV),
    },
  );
  // Same bytes + same fingerprint for both users: B's file is read with B's mapping.
  expect(kraken.mappingId).toBe(mapping.id);
  // F5.15: published to the public library under a pseudonym (never the profile name).
  const libraryEntry = await must<{ id: string; authorName: string | null }>(
    userId,
    'publish_mapping',
    { mappingId: mapping.id, pseudonym: `${tag} Pseudonym` },
  );
  expect(libraryEntry.authorName).toBe(`${tag} Pseudonym`);
  const bookings = await must<{ id: string }>(userId, 'upload_file', {
    projectId: project.id,
    name: 'buchungen.csv',
    contentBase64: base64(BOOKINGS_CSV),
  });

  const walletLabel = `Wallet ${tag} ${randomUUID().slice(0, 6)}`;
  const wallet = await must<{ id: string }>(userId, 'create_wallet', {
    label: walletLabel,
    address,
  });
  await must(userId, 'add_wallet_to_project', {
    projectId: project.id,
    walletId: wallet.id,
  });

  await must(userId, 'calculate_project', { projectId: project.id });
  const correction = await must<{ id: string }>(userId, 'set_price_override', {
    projectId: project.id,
    asset: 'BTC',
    date: '2025-12-31',
    priceChf: '91234.5',
    reason: `Isolation ${tag}`,
  });
  const transactions = await must<{ transactions: { key: string }[] }>(
    userId,
    'search_transactions',
    {},
  );
  const editedKey = transactions.transactions[0]?.key ?? '';
  await must(userId, 'edit_transactions', {
    keys: [editedKey],
    changes: { note: `Isolation ${tag}` },
    reason: `Isolation ${tag}`,
  });
  const editDetail = await must<{ history: { id: string }[] }>(
    userId,
    'get_transaction',
    { key: editedKey },
  );
  await must(userId, 'calculate_project', { projectId: project.id });
  const positions = await must<{ positions: { figureId: string }[] }>(
    userId,
    'list_positions',
    { projectId: project.id },
  );
  const checks = await must<{ items: { key: string }[] }>(
    userId,
    'get_checks',
    { projectId: project.id },
  );
  const exported = await must<{ id: string }>(userId, 'create_export', {
    projectId: project.id,
    kind: 'simple_xlsx',
  });

  const notifications = app.get<NotificationService>(
    (await import('../notifications/application/notification.service'))
      .NotificationService,
  );
  await notifications.raise(userId, `export.failed:${project.id}`, {
    kind: 'error',
    projectId: project.id,
    params: { kind: 'simple_pdf' },
  });

  const chats = app.get<ChatRepositoryPort>(
    (await import('../assistant/ports/assistant.repository.port'))
      .ChatRepositoryPort,
  );
  const conversation = await chats.createConversation(
    userId,
    `Chat ${tag} ${randomUUID().slice(0, 6)}`,
  );
  const proposalId = randomUUID();
  await chats.append(
    conversation.id,
    [
      { role: 'user', content: `Lösche ${projectName}`, data: {} },
      { role: 'assistant', content: '', data: { proposalIds: [proposalId] } },
    ],
    [
      {
        id: proposalId,
        tool: 'delete_project',
        args: { projectId: project.id },
        preview: {
          title: 'Projekt löschen',
          effect: 'destructive',
          summary: projectName,
          changes: [],
          projectId: project.id,
        },
      },
    ],
  );

  return {
    tag,
    email,
    userId,
    projectId: project.id,
    projectName,
    mappingId: mapping.id,
    libraryId: libraryEntry.id,
    fileIds: [kraken.id, bookings.id],
    krakenFileId: kraken.id,
    walletId: wallet.id,
    walletLabel,
    walletAddress: address,
    correctionId: correction.id,
    transactionEditId: editDetail.history[0]?.id ?? '',
    transactionKey: editedKey,
    exportId: exported.id,
    figureId: positions.positions[0]?.figureId ?? 'pos:none',
    openItemKey: checks.items[0]?.key ?? 'none',
    conversationId: conversation.id,
    proposalId,
    tokenId: created.info.id,
    token: created.token,
    advisorName,
  };
}

/**
 * A's data as A sees it through the read tools (+ conversation, notifications, tokens) — taken
 * before and after B's attempts; it must not change.
 */
async function snapshotOfA(): Promise<unknown> {
  const read = async (name: string, args: Record<string, unknown>) => {
    const result = await executor.call(context(A.userId), name, args, {
      policy: FULL_POLICY,
    });
    return result.ok ? result.output : { error: result.error.code };
  };
  const p = { projectId: A.projectId };
  const chats = app.get<ChatRepositoryPort>(
    (await import('../assistant/ports/assistant.repository.port'))
      .ChatRepositoryPort,
  );
  return {
    projects: await read('list_projects', {}),
    project: await read('get_project', p),
    files: await read('list_files', p),
    hints: await read('list_hints', p),
    mappings: await read('list_mappings', {}),
    mapping: await read('get_mapping', { mappingId: A.mappingId }),
    // B may rate A's entry (public) — its content and version must not change.
    library: await (async () => {
      const entry = (await read('get_library_mapping', {
        libraryId: A.libraryId,
      })) as Record<string, unknown>;
      return {
        name: entry['name'],
        version: entry['version'],
        authorName: entry['authorName'],
        spec: entry['spec'],
        error: entry['error'],
      };
    })(),
    wallets: await read('list_wallets', {}),
    projectWallets: await read('list_project_wallets', p),
    rates: await read('list_rates', p),
    result: await read('get_result', p),
    checks: await read('get_checks', p),
    corrections: await read('list_corrections', p),
    exports: await read('list_exports', p),
    mailLog: await read('list_mail_log', p),
    settings: await read('get_settings', {}),
    conversations: (await chats.listConversations(A.userId)).map((c) => ({
      id: c.id,
      title: c.title,
    })),
    messages: (await chats.messages(A.conversationId)).length,
    proposals: (await chats.proposals(A.conversationId)).map((x) => ({
      id: x.id,
      status: x.status,
    })),
    notifications: (
      (await http('GET', '/notifications?status=all', dev(A))).body as {
        items: { id: string; topic?: string; readAt?: string | null }[];
      }
    ).items.map((n) => ({ id: n.id, readAt: n.readAt ?? null })),
    tokens: (
      (await http('GET', '/settings/mcp/tokens', dev(A))).body as {
        id: string;
        revokedAt: string | null;
      }[]
    ).map((t) => ({ id: t.id, revokedAt: t.revokedAt })),
  };
}

/** One attempt of B on A's data: the arguments and what must come back. */
interface Attack {
  readonly args: Record<string, unknown>;
  /** The error codes accepted (default: notFound). `'own'` = B's own data, must not leak A's. */
  readonly expect?: readonly string[] | 'own';
}

/**
 * How every tool is attacked. Keep it complete: the suite fails for a registered tool without
 * an entry, so a new tool cannot ship without its isolation case.
 */
const CASES: Record<string, (a: Seeded, b: Seeded) => Attack[]> = {
  // projects
  list_projects: () => [{ args: {}, expect: 'own' }],
  get_project: (a) => [{ args: { projectId: a.projectId } }],
  create_project: () => [
    {
      args: {
        name: `B own ${randomUUID().slice(0, 4)}`,
        taxYear: 2024,
        canton: 'BE',
      },
      expect: 'own',
    },
  ],
  update_project: (a) => [
    { args: { projectId: a.projectId, name: 'taken over by B' } },
    { args: { projectId: a.projectId, status: 'closed' } },
  ],
  delete_project: (a) => [{ args: { projectId: a.projectId } }],
  // files
  list_files: (a) => [{ args: { projectId: a.projectId } }],
  preview_file: (a, b) => [
    { args: { projectId: a.projectId, fileId: a.krakenFileId } },
    // A's file through B's own project: not a file of this project.
    { args: { projectId: b.projectId, fileId: a.krakenFileId } },
  ],
  list_row_errors: (a, b) => [
    { args: { projectId: a.projectId, fileId: a.krakenFileId } },
    { args: { projectId: b.projectId, fileId: a.krakenFileId } },
  ],
  list_hints: (a) => [{ args: { projectId: a.projectId } }],
  set_hint_status: (a) => [
    {
      args: {
        projectId: a.projectId,
        key: `unrecognisedFile:${a.krakenFileId}`,
        status: 'ignored',
      },
    },
  ],
  assign_file: (a, b) => [
    {
      args: {
        projectId: a.projectId,
        fileId: a.krakenFileId,
        mode: 'evidenceOnly',
      },
    },
    {
      args: {
        projectId: b.projectId,
        fileId: a.krakenFileId,
        mode: 'automatic',
      },
    },
    // B's own file read with A's mapping.
    {
      args: {
        projectId: b.projectId,
        fileId: b.krakenFileId,
        mode: 'mapping',
        mappingId: a.mappingId,
      },
    },
  ],
  // F5.7a: B can neither deactivate A's file in A's project nor through B's own project id.
  set_file_active: (a, b) => [
    {
      args: {
        projectId: a.projectId,
        fileId: a.krakenFileId,
        active: false,
        note: 'planted',
      },
    },
    { args: { projectId: b.projectId, fileId: a.krakenFileId, active: false } },
    { args: { projectId: a.projectId, fileId: b.krakenFileId, active: true } },
  ],
  remove_file: (a, b) => [
    { args: { projectId: a.projectId, fileId: a.krakenFileId } },
    { args: { projectId: b.projectId, fileId: a.fileIds[1] } },
  ],
  upload_file: (a) => [
    {
      args: {
        projectId: a.projectId,
        name: 'planted.csv',
        contentBase64: base64(BOOKINGS_CSV.replace('1000', '999')),
      },
    },
  ],
  request_file_upload: (a) => [
    { args: { projectId: a.projectId, message: 'Kontoauszug' } },
  ],
  // mappings
  list_mappings: () => [{ args: {}, expect: 'own' }],
  get_mapping_schema: () => [{ args: {}, expect: 'own' }],
  get_mapping: (a) => [{ args: { mappingId: a.mappingId } }],
  create_mapping: () => [{ args: { spec: KRAKEN_SPEC }, expect: 'own' }],
  update_mapping: (a) => [
    {
      args: {
        mappingId: a.mappingId,
        spec: { ...(KRAKEN_SPEC as object), name: 'hijacked' },
      },
    },
  ],
  reapply_mapping: (a) => [{ args: { mappingId: a.mappingId } }],
  delete_mapping: (a) => [{ args: { mappingId: a.mappingId } }],
  // mapping library (F5.15–F5.17): reads are public, writes only for the caller
  search_library: () => [{ args: {}, expect: 'own' }],
  // A's entry is public: B reads it — without A's identity (no id, e-mail or profile name).
  get_library_mapping: (a) => [
    { args: { libraryId: a.libraryId }, expect: 'own' },
  ],
  // Taking = a private copy in B's own mappings; never into A's project or file.
  take_library_mapping: (a, b) => [
    { args: { libraryId: a.libraryId }, expect: 'own' },
    {
      args: {
        libraryId: a.libraryId,
        projectId: a.projectId,
        fileId: a.krakenFileId,
      },
    },
    {
      args: {
        libraryId: a.libraryId,
        projectId: b.projectId,
        fileId: a.krakenFileId,
      },
    },
  ],
  // B's own stars on A's public entry.
  rate_library_mapping: (a) => [
    { args: { libraryId: a.libraryId, stars: 4 }, expect: 'own' },
  ],
  // B can neither publish A's mapping nor a new version of A's entry.
  publish_mapping: (a, b) => [
    { args: { mappingId: a.mappingId } },
    { args: { mappingId: b.mappingId, libraryId: a.libraryId } },
  ],
  delete_library_mapping: (a) => [{ args: { libraryId: a.libraryId } }],
  // rates
  list_rates: (a) => [
    { args: { projectId: a.projectId } },
    { args: { projectId: a.projectId, asset: 'BTC' } },
  ],
  refresh_rates: (a) => [{ args: { projectId: a.projectId, force: true } }],
  apply_estv_rates: (a) => [{ args: { projectId: a.projectId } }],
  // results, checks, corrections
  calculate_project: (a) => [{ args: { projectId: a.projectId } }],
  get_result: (a) => [{ args: { projectId: a.projectId } }],
  list_positions: (a) => [{ args: { projectId: a.projectId } }],
  list_income: (a) => [{ args: { projectId: a.projectId } }],
  list_transactions: (a) => [
    { args: { projectId: a.projectId } },
    { args: { projectId: a.projectId, q: 'ETH', treatment: 'balance' } },
  ],
  exclude_booking: (a) => [
    // A wallet transaction key only A has: B's ledger has no such transaction.
    {
      args: { key: `wallet:${a.walletId}:ethereum:0xa:0`, reason: 'B tries A' },
    },
  ],
  get_figure_records: (a, b) => [
    {
      args: { projectId: a.projectId, figureId: a.figureId, includeRaw: true },
    },
    // A's figure through B's project: B's own snapshot has no such figure → empty, never A's rows.
    {
      args: { projectId: b.projectId, figureId: a.figureId, includeRaw: true },
      expect: 'own',
    },
  ],
  get_checks: (a) => [{ args: { projectId: a.projectId } }],
  update_open_item: (a) => [
    { args: { projectId: a.projectId, key: a.openItemKey, done: true } },
  ],
  list_corrections: (a) => [{ args: { projectId: a.projectId } }],
  set_price_override: (a) => [
    {
      args: {
        projectId: a.projectId,
        asset: 'BTC',
        date: '2025-12-31',
        priceChf: '1',
        reason: 'B tries A',
      },
    },
  ],
  reclassify_booking: (a) => [
    {
      args: {
        key: `wallet:${a.walletId}:ethereum:0xa:0`,
        kind: 'deposit',
        reason: 'B tries A',
      },
    },
  ],
  // F9.12: the global transactions — B only ever sees and changes B's own.
  search_transactions: () => [{ args: {}, expect: 'own' }],
  // Same file bytes for A and B → the same key: B sees B's own transaction and only B's edits.
  get_transaction: (a) => [{ args: { key: a.transactionKey }, expect: 'own' }],
  edit_transactions: (a) => [
    {
      args: {
        keys: [`wallet:${a.walletId}:ethereum:0xa:0`],
        changes: { kind: 'spam' },
        reason: 'B tries A',
      },
    },
  ],
  undo_transaction_edit: (a) => [
    { args: { editId: a.transactionEditId } },
    { args: { editId: a.transactionEditId, undo: false } },
  ],
  create_correction: (a) => [
    {
      args: {
        projectId: a.projectId,
        correction: {
          type: 'price_override',
          asset: 'ETH',
          date: '2025-12-31',
          priceChf: '2',
        },
        reason: 'B tries A',
      },
    },
  ],
  undo_correction: (a, b) => [
    { args: { projectId: a.projectId, correctionId: a.correctionId } },
    // A's correction through B's own project.
    { args: { projectId: b.projectId, correctionId: a.correctionId } },
  ],
  // exports + mail
  list_exports: (a) => [{ args: { projectId: a.projectId } }],
  create_export: (a) => [
    { args: { projectId: a.projectId, kind: 'simple_xlsx' } },
  ],
  get_mail_draft: (a) => [{ args: { projectId: a.projectId } }],
  send_mail: (a, b) => [
    {
      args: {
        projectId: a.projectId,
        to: 'b@isolation.test',
        subject: 'A data',
        body: 'please',
        exportIds: [a.exportId],
      },
    },
    // B's own project with A's statement attached: refused like an unknown export.
    {
      args: {
        projectId: b.projectId,
        to: 'b@isolation.test',
        subject: 'A data',
        body: 'please',
        exportIds: [a.exportId],
      },
      expect: ['invalidArguments'],
    },
  ],
  list_mail_log: (a) => [{ args: { projectId: a.projectId } }],
  // wallets
  list_wallets: () => [{ args: {}, expect: 'own' }],
  list_project_wallets: (a) => [{ args: { projectId: a.projectId } }],
  create_wallet: () => [
    {
      args: {
        label: 'B own',
        address:
          'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
      },
      expect: 'own',
    },
  ],
  add_wallet_to_project: (a, b) => [
    { args: { projectId: a.projectId, walletId: a.walletId } },
    { args: { projectId: b.projectId, walletId: a.walletId } },
    { args: { projectId: a.projectId, walletId: b.walletId } },
  ],
  remove_wallet_from_project: (a, b) => [
    { args: { projectId: a.projectId, walletId: a.walletId } },
    { args: { projectId: b.projectId, walletId: a.walletId } },
  ],
  check_wallet_networks: (a) => [{ args: { walletId: a.walletId } }],
  fetch_wallet: (a) => [{ args: { walletId: a.walletId } }],
  // settings + ui
  get_settings: () => [{ args: {}, expect: 'own' }],
  update_settings: () => [
    {
      args: { advisorName: 'B own advisor', onlineRates: false },
      expect: 'own',
    },
  ],
  navigate: (a) => [
    { args: { projectId: a.projectId, tab: 'result', label: 'A' } },
  ],
};

function containsAny(value: unknown, needles: readonly string[]): string[] {
  const text = JSON.stringify(value) ?? '';
  return needles.filter((needle) => needle && text.includes(needle));
}

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    AUTH_MODE: 'dev',
    LOCAL_MODE: '',
    ESTV_AUTO: 'false',
    RATES_ONLINE: 'false',
    LK_CHAINS_FAKE: '1',
    MAIL_ALLOW_PRIVATE_HOSTS: 'true',
  });
  process.env['SETTINGS_ENCRYPTION_KEY'] ||= randomBytes(32).toString('base64');
  // Imported only now: ConfigModule validates the environment when the module is loaded.
  const { AppModule } = await import('../app/app.module');
  const { mcpBodyParser } = await import('../bootstrap');
  const { ToolExecutor } = await import('./application/tool-executor');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Every request of this suite comes from 127.0.0.1: the per-IP / per-account budgets are
    // not what is tested here (the per-token MCP limit in McpAccess still applies).
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: () =>
        Promise.resolve({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.use('/api/mcp', mcpBodyParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  api = `http://127.0.0.1:${port}/api`;
  executor = app.get(ToolExecutor);

  // BIP-173 example addresses (public test vectors, no one's wallet).
  A = await seed('Alice', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  B = await seed('Bob', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  aData = [
    A.email,
    A.projectName,
    A.walletLabel,
    A.walletAddress,
    A.advisorName,
    `Alice Isolation`,
  ];
  aIds = [
    A.userId,
    A.projectId,
    A.mappingId,
    ...A.fileIds,
    A.walletId,
    A.correctionId,
    A.transactionEditId,
    A.exportId,
    A.conversationId,
    A.proposalId,
    A.tokenId,
  ];
}, 180_000);

afterAll(async () => {
  await app?.close();
});

describe('tool layer: B never reaches A (every tool, every channel)', () => {
  let before: unknown;
  beforeAll(async () => {
    before = await snapshotOfA();
  });

  it('has an isolation case for every registered tool (new tools must add one)', () => {
    const missing = executor.registry
      .all()
      .map((tool) => tool.name)
      .filter((name) => !(name in CASES));
    expect(missing).toEqual([]);
    const stale = Object.keys(CASES).filter(
      (name) => !executor.registry.get(name),
    );
    expect(stale).toEqual([]);
  });

  it('refuses every tool called as B with A ids, and leaks nothing of A', async () => {
    const problems: string[] = [];
    for (const tool of executor.registry.all()) {
      const attacks = CASES[tool.name]?.(A, B) ?? [];
      for (const attack of attacks) {
        for (const source of ['chat', 'mcp'] as const) {
          if (!availableIn(tool, source)) continue;
          const result = await executor.call(
            context(B.userId, source),
            tool.name,
            attack.args,
            source === 'mcp' ? { policy: FULL_POLICY } : { confirmed: true },
          );
          const label = `${source} ${tool.name} ${JSON.stringify(attack.args).slice(0, 120)}`;
          const leaked = containsAny(result, aData);
          if (leaked.length > 0)
            problems.push(`${label} leaked ${leaked.join(', ')}`);
          if (attack.expect === 'own') {
            const ids = containsAny(result.ok ? result.output : result, aIds);
            if (ids.length > 0)
              problems.push(`${label} returned A ids ${ids.join(', ')}`);
            continue;
          }
          const accepted = attack.expect ?? ['notFound'];
          if (result.ok) {
            problems.push(`${label} SUCCEEDED for B`);
          } else if (!accepted.includes(result.error.code)) {
            problems.push(
              `${label} failed with ${result.error.code} (${result.error.message}), expected ${accepted.join('|')}`,
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it('positive control: the same read tools work for B on B’s own ids', async () => {
    // Proves the harness tells success from refusal: the refusals above are owner checks,
    // not tools that fail for everyone.
    const failures: string[] = [];
    for (const tool of executor.registry.all()) {
      if (tool.effect !== 'readOnly') continue;
      for (const attack of CASES[tool.name]?.(B, B) ?? []) {
        const source = availableIn(tool, 'mcp') ? 'mcp' : 'chat';
        const result = await executor.call(
          context(B.userId, source),
          tool.name,
          attack.args,
          source === 'mcp' ? { policy: FULL_POLICY } : {},
        );
        if (!result.ok) {
          failures.push(
            `${tool.name}: ${result.error.code} ${result.error.message}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('chat proposal previews for A ids show nothing of A', async () => {
    const leaks: string[] = [];
    for (const tool of executor.registry.forChat()) {
      if (tool.effect === 'readOnly') continue;
      for (const attack of CASES[tool.name]?.(A, B) ?? []) {
        let input: unknown;
        try {
          input = executor.parse(tool as AnyTool, attack.args);
        } catch {
          continue;
        }
        const preview = await executor.preview(
          context(B.userId, 'chat'),
          tool,
          input,
        );
        const leaked = containsAny(preview, aData);
        if (leaked.length > 0) leaks.push(`${tool.name}: ${leaked.join(', ')}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("A's data is unchanged after all of B's attempts", async () => {
    expect(await snapshotOfA()).toEqual(before);
  });
});

describe('HTTP: conversations, proposals, notifications, tokens, audit', () => {
  it("B cannot read, rename, delete or decide in A's conversation", async () => {
    const list = await http('GET', '/chat/conversations', dev(B));
    expect(list.status).toBe(200);
    expect(containsAny(list.body, [A.conversationId, ...aData])).toEqual([]);
    const id = A.conversationId;
    expect(
      (await http('GET', `/chat/conversations/${id}`, dev(B))).status,
    ).toBe(404);
    expect(
      (await http('PATCH', `/chat/conversations/${id}`, dev(B), { title: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (await http('DELETE', `/chat/conversations/${id}`, dev(B))).status,
    ).toBe(404);
    for (const action of ['confirm', 'cancel']) {
      expect(
        (
          await http(
            'POST',
            `/chat/conversations/${id}/proposals/${A.proposalId}/${action}`,
            dev(B),
          )
        ).status,
      ).toBe(404);
      // A's proposal through B's own conversation.
      expect(
        (
          await http(
            'POST',
            `/chat/conversations/${B.conversationId}/proposals/${A.proposalId}/${action}`,
            dev(B),
          )
        ).status,
      ).toBe(404);
    }
    const chats = app.get<ChatRepositoryPort>(
      (await import('../assistant/ports/assistant.repository.port'))
        .ChatRepositoryPort,
    );
    expect((await chats.findProposal(A.proposalId))?.status).toBe('pending');
    expect((await http('GET', `/projects/${A.projectId}`, dev(A))).status).toBe(
      200,
    );
  });

  it("B sees none of A's notifications and cannot read or dismiss them", async () => {
    const mine = await http('GET', '/notifications?status=all', dev(B));
    expect(mine.status).toBe(200);
    expect(containsAny(mine.body, [A.projectId, ...aData])).toEqual([]);
    const aList = (await http('GET', '/notifications?status=all', dev(A)))
      .body as { items: { id: string }[] };
    const aNotification = aList.items[0]?.id;
    expect(aNotification).toBeDefined();
    expect(
      (await http('POST', `/notifications/${aNotification}/read`, dev(B)))
        .status,
    ).toBe(404);
    expect(
      (await http('POST', `/notifications/${aNotification}/dismiss`, dev(B)))
        .status,
    ).toBe(404);
  });

  it("B can neither list nor revoke A's token; the audit log is per user", async () => {
    const tokens = await http('GET', '/settings/mcp/tokens', dev(B));
    expect(containsAny(tokens.body, [A.tokenId])).toEqual([]);
    expect(
      (await http('DELETE', `/settings/mcp/tokens/${A.tokenId}`, dev(B)))
        .status,
    ).toBe(404);

    const audit = app.get<ToolAuditRepositoryPort>(
      (await import('./ports/tool-audit.repository.port'))
        .ToolAuditRepositoryPort,
    );
    const aRows = await audit.listByUser(A.userId, { limit: 500 });
    const bRows = await audit.listByUser(B.userId, { limit: 500 });
    expect(bRows.length).toBeGreaterThan(50);
    // Every one of B's attempts is in B's log — none landed in A's (A only has its own calls).
    expect(aRows.every((row) => row.status !== 'refused')).toBe(true);
    const bAudit = await http('GET', '/settings/mcp/audit?limit=500', dev(B));
    expect(bAudit.status).toBe(200);
    expect(containsAny(bAudit.body, aData)).toEqual([]);
    const aAudit = await http('GET', '/settings/mcp/audit?limit=500', dev(A));
    // B typed A's ids into B's own calls; none of those calls shows up for A.
    expect(
      containsAny(aAudit.body, [B.projectId, B.walletId, B.mappingId]),
    ).toEqual([]);
  });
});

describe('MCP end to end with B’s personal access token', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ name: 'isolation-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${api}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${B.token}` } },
      }),
    );
  });
  afterAll(async () => {
    await client?.close();
  });

  it("lists only B's projects as resources and refuses A's", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain(`lazykoins://projects/${B.projectId}`);
    expect(containsAny(resources, [...aIds, ...aData])).toEqual([]);
    await expect(
      client.readResource({ uri: `lazykoins://projects/${A.projectId}` }),
    ).rejects.toThrow(/No such project/);
    await expect(
      client.readResource({
        uri: `lazykoins://projects/${encodeURIComponent(A.projectId)}`,
      }),
    ).rejects.toThrow();
  });

  it('every tool with A ids fails over MCP', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(40);
    for (const tool of tools) {
      for (const attack of CASES[tool.name]?.(A, B) ?? []) {
        if (attack.expect === 'own') continue;
        const result = await client.callTool({
          name: tool.name,
          arguments: attack.args,
        });
        expect(result.isError, `${tool.name}`).toBe(true);
        expect(containsAny(result, aData), tool.name).toEqual([]);
      }
    }
  }, 120_000);

  it('neither a user argument nor _meta switches the user', async () => {
    const named = await client.callTool({
      name: 'list_projects',
      arguments: { userId: A.userId },
    });
    expect(named.isError).toBe(true);
    expect(JSON.stringify(named.content)).toContain('refused');

    const meta = await client.callTool({
      name: 'list_projects',
      arguments: {},
      _meta: { userId: A.userId, ownerId: A.userId, 'lazykoins/user': A.email },
    });
    expect(meta.isError).toBeFalsy();
    const ids = (
      meta.structuredContent as { projects: { id: string }[] }
    ).projects.map((p) => p.id);
    expect(ids).toContain(B.projectId);
    expect(ids).not.toContain(A.projectId);
  });

  it('a PAT works only on /api/mcp, a sign-in token never on /api/mcp', async () => {
    expect((await http('GET', '/projects', B.token)).status).toBe(401);
    const devOnMcp = await http('POST', '/mcp', dev(A), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(devOnMcp.status).toBe(401);
    // A's own token still works and still sees A's project (B changed nothing).
    const own = new Client({ name: 'isolation-test-a', version: '1.0.0' });
    await own.connect(
      new StreamableHTTPClientTransport(new URL(`${api}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${A.token}` } },
      }),
    );
    const listed = await own.callTool({ name: 'list_projects', arguments: {} });
    const ids = (
      listed.structuredContent as { projects: { id: string }[] }
    ).projects.map((p) => p.id);
    expect(ids).toEqual([A.projectId]);
    await own.close();
  });

  it("switching B's MCP off locks B's token out — A is unaffected", async () => {
    const settings = app.get<AssistantSettingsRepositoryPort>(
      (await import('../assistant/ports/assistant.repository.port'))
        .AssistantSettingsRepositoryPort,
    );
    const current = await settings.find(B.userId);
    expect(current?.mcpEnabled).toBe(true);
    const mcp = app.get<McpService>(
      (await import('../mcp/mcp.service')).McpService,
    );
    await mcp.saveSettings(B.userId, {
      enabled: false,
      areas: [...TOOL_AREAS],
      allowWrite: true,
    });
    const refused = await http('POST', '/mcp', B.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(refused.status).toBe(403);
    expect((await settings.find(A.userId))?.mcpEnabled).toBe(true);
  });
});

describe('HTTP: the mapping library (F5.15–F5.17, web only)', () => {
  const aIdentity = () => [A.userId, A.email, 'Alice Isolation'];

  it("shows A's entry to B by pseudonym only; B can neither delete nor republish it", async () => {
    const list = await http('GET', '/library', dev(B));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(A.libraryId);
    expect(containsAny(list.body, aIdentity())).toEqual([]);
    const one = await http('GET', `/library/${A.libraryId}`, dev(B));
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({
      mine: false,
      authorName: 'Alice Pseudonym',
    });
    expect(containsAny(one.body, aIdentity())).toEqual([]);

    expect(
      (await http('DELETE', `/library/${A.libraryId}`, dev(B))).status,
    ).toBe(404);
    expect(
      (
        await http('POST', '/library', dev(B), {
          spec: KRAKEN_SPEC,
          libraryId: A.libraryId,
          confirmed: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await http('POST', '/library/review', dev(B), {
          mappingId: A.mappingId,
        })
      ).status,
    ).toBe(404);
    expect(
      (await http('GET', `/projects/${A.projectId}/library-matches`, dev(B)))
        .status,
    ).toBe(404);
    // Authors cannot rate their own entry; others can.
    const own = await http('PUT', `/library/${A.libraryId}/rating`, dev(A), {
      stars: 5,
    });
    expect(own.status).toBe(409);
    expect(own.body).toMatchObject({ code: 'ownEntry' });
    expect(
      (
        await http('PUT', `/library/${B.libraryId}/rating`, dev(A), {
          stars: 5,
        })
      ).status,
    ).toBe(200);
    const still = await http('GET', `/library/${A.libraryId}`, dev(A));
    expect(still.body).toMatchObject({ mine: true, version: 1 });
  });

  it('F5.18: the public endpoint answers without a sign-in — pseudonyms only, exact keys', async () => {
    const anonymous = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${api}${path}`, init);
      return {
        status: response.status,
        cache: response.headers.get('cache-control'),
        body: (await response.json()) as Record<string, unknown>,
      };
    };
    const page = await anonymous('/public/library?limit=50');
    expect(page.status).toBe(200);
    expect(page.cache).toBe('public, max-age=60');
    const items = page.body['items'] as Record<string, unknown>[];
    const mine = items.find((item) => item['id'] === A.libraryId);
    expect(mine).toBeDefined();
    expect(Object.keys(mine ?? {}).sort()).toEqual(
      [
        'authorName',
        'description',
        'fingerprint',
        'id',
        'name',
        'platform',
        'publishedAt',
        'ratingAverage',
        'ratingCount',
        'updatedAt',
        'usageCount',
        'version',
      ].sort(),
    );
    expect(containsAny(page.body, aIdentity())).toEqual([]);
    const one = await anonymous(`/public/library/${A.libraryId}`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ authorName: 'Alice Pseudonym' });
    expect(Object.keys(one.body)).toContain('spec');
    expect(containsAny(one.body, aIdentity())).toEqual([]);
    const match = await anonymous('/public/library/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'ledgers.csv',
        headers: (KRAKEN_SPEC as { match: { headers: string[] } }).match
          .headers,
      }),
    });
    expect(match.status).toBe(200);
    expect(match.cache).toBe('no-store');
    expect(JSON.stringify(match.body)).toContain(A.libraryId);
    expect(containsAny(match.body, aIdentity())).toEqual([]);
    // Only the two fields: anything else is refused.
    const extra = await anonymous('/public/library/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'x.csv', headers: [], rows: [['1']] }),
    });
    expect(extra.status).toBe(400);
    // The desktop's settings routes do not exist on the web.
    expect((await http('GET', '/settings/library', dev(B))).status).toBe(404);
    expect((await http('GET', '/library/status', dev(B))).body).toMatchObject({
      mode: 'web',
      available: true,
      readOnly: false,
    });
  });

  it("A deleting the entry leaves B's private copy working", async () => {
    const taken = await http(
      'POST',
      `/library/${A.libraryId}/take`,
      dev(B),
      {},
    );
    expect(taken.status).toBe(201);
    const copyId = (taken.body as { mapping: { id: string } }).mapping.id;
    expect(
      (await http('DELETE', `/library/${A.libraryId}`, dev(A))).status,
    ).toBe(204);
    expect((await http('GET', `/library/${A.libraryId}`, dev(B))).status).toBe(
      404,
    );
    // F5.18: gone from the public endpoint too.
    expect((await fetch(`${api}/public/library/${A.libraryId}`)).status).toBe(
      404,
    );
    expect(
      JSON.stringify(
        await (await fetch(`${api}/public/library?limit=50`)).json(),
      ),
    ).not.toContain(A.libraryId);
    const copy = await http('GET', `/mappings/${copyId}`, dev(B));
    expect(copy.status).toBe(200);
    expect(copy.body).toMatchObject({
      origin: 'library',
      library: { id: A.libraryId },
    });
    // The copy is B's: A cannot see it.
    expect((await http('GET', `/mappings/${copyId}`, dev(A))).status).toBe(404);
  });
});
