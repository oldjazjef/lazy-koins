import type {
  NewProjectExport,
  ProjectExportContent,
  ProjectExportMeta,
} from '../domain/project-export';

/** Persistence contract for generated statements (F10.5). */
export abstract class ProjectExportRepositoryPort {
  /** Newest first, without the bytes. */
  abstract listByProject(projectId: string): Promise<ProjectExportMeta[]>;

  abstract findContent(id: string): Promise<ProjectExportContent | undefined>;

  abstract create(
    projectId: string,
    input: NewProjectExport,
  ): Promise<ProjectExportMeta>;
}

/** Prints HTML to PDF (Chromium via Playwright in the API, F10). */
export abstract class PdfRendererPort {
  /** `false` when no browser can be started (the API then answers 503 for PDFs). */
  abstract available(): Promise<boolean>;

  abstract render(html: string): Promise<Uint8Array>;
}

export class PdfUnavailableError extends Error {
  constructor(reason: string) {
    super(`PDF rendering is not available: ${reason}`);
    this.name = 'PdfUnavailableError';
  }
}
