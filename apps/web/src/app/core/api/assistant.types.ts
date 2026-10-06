// --- Assistant (F11.14–F11.16) — mirrors apps/api `chat`, `assistant` and `mcp` DTOs ---

/** The workspace tabs the chat may name as context (same list as the project workspace). */
export const CHAT_CONTEXT_TABS = [
  'files',
  'hints',
  'wallets',
  'rates',
  'result',
  'checks',
  'corrections',
  'exports',
] as const;
export type ChatContextTab = (typeof CHAT_CONTEXT_TABS)[number];

/** Why the chat cannot answer (`GET /api/chat/status`). */
export const CHAT_UNAVAILABLE_CODES = [
  'aiDisabled',
  'aiNotConfigured',
  'privateUrl',
  'invalidUrl',
  'keyUnreadable',
] as const;

export interface ChatStatus {
  available: boolean;
  code: string | null;
  detail: string | null;
  consentRequired: boolean;
  provider: string;
  model: string;
}

export interface ChatContext {
  route?: string;
  projectId?: string;
  tab?: ChatContextTab;
}

export interface AskRequest {
  text: string;
  context?: ChatContext;
  consent?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export const TOOL_EFFECTS = ['readOnly', 'write', 'destructive'] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

export const PROPOSAL_STATUSES = [
  'pending',
  'executed',
  'failed',
  'cancelled',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ProposalChange {
  label: string;
  before: string | null;
  after: string | null;
}

export interface ProposalView {
  id: string;
  tool: string;
  title: string;
  effect: ToolEffect;
  summary: string;
  changes: ProposalChange[];
  projectId: string | null;
  status: ProposalStatus;
  outcome: {
    summary?: string;
    error?: { code: string; message: string };
  } | null;
  decidedAt: string | null;
}

export type ChatAttachment =
  | { kind: 'upload'; projectId: string; message: string }
  | { kind: 'link'; href: string; label: string };

export type ChatRole = 'user' | 'assistant' | 'event';

export interface ChatMessageView {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  attachments: ChatAttachment[];
  proposals: ProposalView[];
  toolsUsed: string[];
}

export interface ConversationView extends ConversationSummary {
  messages: ChatMessageView[];
}

// --- Assistant settings (Einstellungen › AI › Assistent, F11.15) ---

export interface AssistantSettings {
  systemPrompt: string;
  isDefault: boolean;
  defaultPrompt: string;
  safetyRules: string;
  maxLength: number;
  chatConsentAt: string | null;
}

/** `PUT /api/assistant/settings` — `systemPrompt: null` (or '') resets to the default. */
export interface SaveAssistantSettingsRequest {
  systemPrompt?: string | null;
  revokeChatConsent?: boolean;
}

// --- MCP (Einstellungen › MCP, F11.16) ---

export const MCP_AREAS = [
  'projects',
  'files',
  'mappings',
  'rates',
  'results',
  'checks',
  'corrections',
  'exports',
  'wallets',
  'settings',
  'mail',
] as const;
export type McpArea = (typeof MCP_AREAS)[number];

export interface McpTool {
  name: string;
  title: string;
  description: string;
  area: McpArea;
  effect: ToolEffect;
}

export interface McpSettings {
  enabled: boolean;
  areas: McpArea[];
  allowWrite: boolean;
  endpoint: string;
  mode: 'web' | 'desktop';
  tools: McpTool[];
}

export interface SaveMcpSettingsRequest {
  enabled: boolean;
  areas: McpArea[];
  allowWrite: boolean;
}

export const MCP_TOKEN_STATES = ['active', 'expired', 'revoked'] as const;
export type McpTokenState = (typeof MCP_TOKEN_STATES)[number];

export interface McpToken {
  id: string;
  name: string;
  hint: string;
  state: McpTokenState;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** How long a new token is valid: days, or `never` (what the create dialog offers). */
export const TOKEN_EXPIRIES = ['30', '90', '365', 'never'] as const;
export type TokenExpiry = (typeof TOKEN_EXPIRIES)[number];

export interface CreateMcpTokenRequest {
  name: string;
  /** 1..365; null = never expires. */
  expiresInDays?: number | null;
}

/** The token itself is in this answer only — it is never shown again. */
export interface CreatedMcpToken {
  token: string;
  info: McpToken;
}

export const AUDIT_SOURCES = ['chat', 'mcp'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_STATUSES = ['ok', 'error', 'refused', 'proposed'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export interface AuditEntry {
  id: string;
  userId: string;
  source: AuditSource;
  tool: string;
  args: string;
  status: AuditStatus;
  errorCode: string | null;
  durationMs: number;
  tokenId: string | null;
  createdAt: string;
}
