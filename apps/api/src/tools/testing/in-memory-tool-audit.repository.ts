import type {
  NewToolAuditEntry,
  ToolAuditCriteria,
  ToolAuditEntry,
} from '../domain/tool-audit';
import { ToolAuditRepositoryPort } from '../ports/tool-audit.repository.port';

/** Port double over an array. */
export class InMemoryToolAuditRepository extends ToolAuditRepositoryPort {
  readonly rows: ToolAuditEntry[] = [];

  async add(entry: NewToolAuditEntry): Promise<ToolAuditEntry> {
    const row: ToolAuditEntry = {
      ...entry,
      id: `audit-${this.rows.length + 1}`,
      createdAt: new Date(
        Date.UTC(2026, 0, 1, 0, 0, this.rows.length),
      ).toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async listByUser(
    userId: string,
    criteria: ToolAuditCriteria,
  ): Promise<ToolAuditEntry[]> {
    return this.rows
      .filter(
        (row) =>
          row.userId === userId &&
          (!criteria.source || row.source === criteria.source),
      )
      .reverse()
      .slice(0, criteria.limit);
  }
}
