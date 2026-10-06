import type {
  NewToolAuditEntry,
  ToolAuditCriteria,
  ToolAuditEntry,
} from '../domain/tool-audit';

/** The audit log of tool calls (chat + MCP), per user. */
export abstract class ToolAuditRepositoryPort {
  abstract add(entry: NewToolAuditEntry): Promise<ToolAuditEntry>;

  /** The user's entries, newest first. */
  abstract listByUser(
    userId: string,
    criteria: ToolAuditCriteria,
  ): Promise<ToolAuditEntry[]>;
}
