import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import type { StoredFileContent } from '../../domain/project-file';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { loadOwnProjectFile, orUnreadable, readableOf } from '../file-access';
import { SourceFileReader } from '../source-file-reader';

export class GetFileContentQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
  ) {}
}

/** F5.3: the original bytes, unchanged, with the name of the first upload. */
@QueryHandler(GetFileContentQuery)
export class GetFileContentHandler implements IQueryHandler<
  GetFileContentQuery,
  StoredFileContent
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
  }: GetFileContentQuery): Promise<StoredFileContent> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    return (await readableOf(this.files, file)).content;
  }
}

export class PreviewFileQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    readonly rows: number,
  ) {}
}

export type FilePreview =
  | {
      readonly kind: 'table';
      readonly sheets: readonly {
        readonly name: string;
        /** The first rows as text; the first is usually the header. */
        readonly rows: readonly (readonly string[])[];
        readonly totalRows: number;
      }[];
    }
  | { readonly kind: 'pdf' };

/** F5.6: the first rows of each table, or "a PDF — load the content". */
@QueryHandler(PreviewFileQuery)
export class PreviewFileHandler implements IQueryHandler<
  PreviewFileQuery,
  FilePreview
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly reader: SourceFileReader,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
    rows,
  }: PreviewFileQuery): Promise<FilePreview> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    if (file.kind === 'pdf') return { kind: 'pdf' };
    const { readable } = await readableOf(this.files, file);
    const source = await orUnreadable(() => this.reader.read(readable));
    if (source.kind === 'pdf') return { kind: 'pdf' };
    return {
      kind: 'table',
      sheets: source.sheets.map((sheet) => ({
        name: sheet.name,
        rows: sheet.rows.slice(0, rows + 1),
        totalRows: sheet.rows.length,
      })),
    };
  }
}
