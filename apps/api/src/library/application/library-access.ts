import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type MappingSpec,
  mappingFingerprint,
  type PrivacyFinding,
  removePrivacyFindings,
  scanMappingPrivacy,
} from '@lazykoins/engine';
import {
  loadOwnMapping,
  specOr400,
} from '../../mappings/application/mapping-access';
import type { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import {
  isVisible,
  LIBRARY_LIMITS,
  type LibraryMapping,
  type PublishReview,
} from '../domain/library-mapping';
import type { LibraryRepositoryPort } from '../ports/library.repository.port';

/** An entry anyone may see: missing, deleted and hidden read the same (404). */
export async function loadActiveEntry(
  library: LibraryRepositoryPort,
  libraryId: string,
): Promise<LibraryMapping> {
  const entry = await library.findById(libraryId);
  if (!entry || !isVisible(entry)) {
    throw new NotFoundException('No such library mapping');
  }
  return entry;
}

/**
 * An entry the user wrote. Someone else's entry reads exactly like a missing one (404) — the
 * answer must not tell whether an id exists or who wrote it.
 */
export async function loadOwnEntry(
  library: LibraryRepositoryPort,
  userId: string,
  libraryId: string,
): Promise<LibraryMapping> {
  const entry = await library.findById(libraryId);
  if (!entry || !isVisible(entry) || entry.authorId !== userId) {
    throw new NotFoundException('No such library mapping');
  }
  return entry;
}

/** What is published: one of my mappings, or a spec (an uploaded `.json`). */
export interface PublishSource {
  readonly mappingId?: string;
  readonly spec?: unknown;
}

export interface PublishRequest extends PublishSource {
  /** JSON Pointers of findings to remove before publishing. */
  readonly remove?: readonly string[];
  /** Publish a new version of this entry of mine (else a new entry). */
  readonly libraryId?: string;
}

/** Canonical JSON size in bytes. */
export function specSize(spec: MappingSpec): number {
  return Buffer.byteLength(JSON.stringify(spec), 'utf8');
}

/**
 * The review before publishing (F5.15): the exact spec that becomes public after the requested
 * removals, the remaining privacy findings, the target entry and the author's last pseudonym.
 * Pure reading — nothing is stored.
 */
export async function buildReview(
  deps: {
    readonly library: LibraryRepositoryPort;
    readonly mappings: ImportMappingRepositoryPort;
  },
  userId: string,
  request: PublishRequest,
): Promise<PublishReview & { readonly sourceMappingId: string | null }> {
  const hasMapping = request.mappingId !== undefined;
  const hasSpec = request.spec !== undefined;
  if (hasMapping === hasSpec) {
    throw new BadRequestException(
      'Give exactly one of mappingId (one of your mappings) or spec (a mapping JSON)',
    );
  }
  let raw: unknown;
  let sourceMappingId: string | null = null;
  let libraryCopy = false;
  if (request.mappingId !== undefined) {
    const mapping = await loadOwnMapping(
      deps.mappings,
      userId,
      request.mappingId,
    );
    raw = mapping.spec;
    sourceMappingId = mapping.id;
    libraryCopy = mapping.origin === 'library';
  } else {
    raw = specOr400(request.spec);
  }
  const spec = specOr400(removePrivacyFindings(raw, request.remove ?? []));
  const target = request.libraryId
    ? await loadOwnEntry(deps.library, userId, request.libraryId)
    : undefined;
  const existing = sourceMappingId
    ? (await deps.library.findActiveByAuthor(userId)).find(
        (entry) => entry.sourceMappingId === sourceMappingId,
      )
    : undefined;
  return {
    spec,
    name: spec.name,
    platform: spec.platform,
    fingerprint: mappingFingerprint(spec),
    size: specSize(spec),
    findings: scanMappingPrivacy(spec),
    target: target ? { id: target.id, nextVersion: target.version + 1 } : null,
    existing: existing ? { id: existing.id, version: existing.version } : null,
    lastAuthorName: await deps.library.lastAuthorName(userId),
    libraryCopy,
    sourceMappingId,
  };
}

/** 422 `specTooLarge` above the limit. */
export function assertSpecSize(size: number): void {
  if (size > LIBRARY_LIMITS.maxSpecBytes) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: `The mapping is too large for the library (${size} bytes, at most ${LIBRARY_LIMITS.maxSpecBytes})`,
      code: 'specTooLarge',
    });
  }
}

/** 422 `privacyFindings` — the author has neither removed nor explicitly kept them. */
export function privacyRefusal(
  findings: readonly PrivacyFinding[],
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message:
      'The mapping contains values that look personal: remove them or confirm keeping them (acknowledgeFindings)',
    code: 'privacyFindings',
    findings: findings.map((finding) => ({
      path: finding.path,
      kind: finding.kind,
      removable: finding.removable,
    })),
  });
}

/** 429 `publishLimit` — the spam guard (new entries per author and day). */
export function publishLimit(): HttpException {
  return new HttpException(
    {
      statusCode: 429,
      error: 'Too Many Requests',
      message: `At most ${LIBRARY_LIMITS.publishesPerDay} new library mappings per day`,
      code: 'publishLimit',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
