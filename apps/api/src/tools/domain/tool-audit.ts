import type { ToolSource } from './tool';

export const TOOL_AUDIT_STATUSES = [
  'ok',
  'error',
  'refused',
  'proposed',
] as const;
/** `refused` = policy (area off, write tools off); `proposed` = a chat proposal, not run yet. */
export type ToolAuditStatus = (typeof TOOL_AUDIT_STATUSES)[number];

/** One audited tool call — never the arguments' secrets (`summarizeArgs`). */
export interface ToolAuditEntry {
  readonly id: string;
  readonly userId: string;
  readonly source: ToolSource;
  readonly tool: string;
  readonly args: string;
  readonly status: ToolAuditStatus;
  readonly errorCode: string | null;
  readonly durationMs: number;
  readonly tokenId: string | null;
  readonly createdAt: string;
}

export type NewToolAuditEntry = Omit<ToolAuditEntry, 'id' | 'createdAt'>;

export interface ToolAuditCriteria {
  readonly source?: ToolSource;
  /** Newest first; at most this many. */
  readonly limit: number;
}
