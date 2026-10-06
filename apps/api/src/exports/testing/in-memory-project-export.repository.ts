import {
  mediaTypeOf,
  type NewProjectExport,
  type ProjectExportContent,
  type ProjectExportMeta,
} from '../domain/project-export';
import {
  PdfRendererPort,
  PdfUnavailableError,
  ProjectExportRepositoryPort,
} from '../ports/project-export.repository.port';

/** Port double for handler specs: a real implementation over a Map. */
export class InMemoryProjectExportRepository extends ProjectExportRepositoryPort {
  readonly rows: ProjectExportContent[] = [];
  private seq = 0;

  async listByProject(projectId: string): Promise<ProjectExportMeta[]> {
    return this.rows
      .filter((r) => r.projectId === projectId)
      .reverse()
      .map(({ bytes: _bytes, ...meta }) => meta);
  }

  async findContent(id: string): Promise<ProjectExportContent | undefined> {
    return this.rows.find((r) => r.id === id);
  }

  async create(
    projectId: string,
    input: NewProjectExport,
  ): Promise<ProjectExportMeta> {
    this.seq += 1;
    const row: ProjectExportContent = {
      id: `e${this.seq}`,
      projectId,
      kind: input.kind,
      fileName: input.fileName,
      mediaType: mediaTypeOf(input.kind),
      size: input.bytes.byteLength,
      snapshotId: input.snapshotId,
      wealthChf: input.wealthChf,
      incomeChf: input.incomeChf,
      createdAt: `2026-01-0${Math.min(this.seq, 9)}T00:00:00.000Z`,
      bytes: input.bytes,
    };
    this.rows.push(row);
    const { bytes: _bytes, ...meta } = row;
    return meta;
  }
}

/** A PDF renderer that records the HTML and returns a minimal PDF, or is unavailable. */
export class FakePdfRenderer extends PdfRendererPort {
  readonly rendered: string[] = [];

  constructor(private readonly ok = true) {
    super();
  }

  async available(): Promise<boolean> {
    return this.ok;
  }

  async render(html: string): Promise<Uint8Array> {
    if (!this.ok) throw new PdfUnavailableError('no browser in tests');
    this.rendered.push(html);
    return new TextEncoder().encode('%PDF-1.4\n% fake\n%%EOF\n');
  }
}
