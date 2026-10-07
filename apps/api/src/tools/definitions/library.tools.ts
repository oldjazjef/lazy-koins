import { z } from 'zod';
import { scanMappingPrivacy } from '@lazykoins/engine';
import {
  LIBRARY_LIMITS,
  LIBRARY_SORTS,
  type LibraryEntryView,
} from '../../library/domain/library-mapping';
import type { LibraryService } from '../../library/library.service';
import { type AnyTool, defineTool } from '../domain/tool';
import { previewText } from '../domain/preview-texts';
import { capped, fileLink, id, limit, link } from './common';

/**
 * The mapping library (F5.15–F5.17, web only — not registered on the desktop). Reads are
 * public (every signed-in user sees every entry); writes act only for the caller: publishing and
 * deleting reach only the caller's own mappings and entries (someone else's = notFound), taking
 * makes a private copy, rating is the caller's own stars. No input names a user, and no output
 * carries an author's identity — only the chosen pseudonym and `mine`.
 */
const entryOut = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(),
  description: z.string().nullable(),
  version: z.number(),
  authorName: z
    .string()
    .nullable()
    .describe('The pseudonym the author chose; null = anonymous.'),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number(),
  usageCount: z.number(),
  publishedAt: z.string(),
  updatedAt: z.string(),
  mine: z.boolean().describe('The user is the author.'),
  myRating: z.number().nullable(),
  link,
});

function entryOf(entry: LibraryEntryView): z.input<typeof entryOut> {
  return {
    id: entry.id,
    name: entry.name,
    platform: entry.platform,
    description: entry.description,
    version: entry.version,
    authorName: entry.authorName,
    ratingAverage: entry.ratingAverage,
    ratingCount: entry.ratingCount,
    usageCount: entry.usageCount,
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt,
    mine: entry.mine,
    myRating: entry.myRating,
    link: `/app/library/${encodeURIComponent(entry.id)}`,
  };
}

const libraryId = id('library mapping').describe(
  'The library entry id (from search_library).',
);

export function libraryTools(library: LibraryService): AnyTool[] {
  return [
    defineTool({
      name: 'search_library',
      title: 'Mapping-Bibliothek durchsuchen',
      description:
        'The public mapping library shared by all users: published mapping specs with platform, version, average rating and how often they were taken. Authors appear only by pseudonym. Use it before writing a new mapping.',
      area: 'mappings',
      effect: 'readOnly',
      input: z.object({
        query: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe('Words in the name, platform or description.'),
        platform: z.string().trim().max(40).optional(),
        sort: z.enum(LIBRARY_SORTS).default('rating'),
        limit: limit(20, 50),
      }),
      output: z.object({
        entries: z.array(entryOut),
        total: z.number(),
        truncated: z.boolean(),
      }),
      async run(ctx, input) {
        const found = await library.search(ctx.userId, {
          query: input.query,
          platform: input.platform,
          sort: input.sort,
        });
        const list = capped(found, input.limit);
        return {
          entries: list.items.map(entryOf),
          total: list.total,
          truncated: list.truncated,
        };
      },
    }),
    defineTool({
      name: 'get_library_mapping',
      title: 'Bibliotheks-Mapping anzeigen',
      description: 'One library entry with its mapping spec (JSON).',
      area: 'mappings',
      effect: 'readOnly',
      input: z.object({ libraryId }),
      output: entryOut.extend({ spec: z.record(z.string(), z.unknown()) }),
      async run(ctx, input) {
        const entry = await library.get(ctx.userId, input.libraryId);
        return {
          ...entryOf(entry),
          spec: entry.spec as unknown as Record<string, unknown>,
        };
      },
    }),
    defineTool({
      name: 'take_library_mapping',
      title: 'Mapping aus Bibliothek übernehmen',
      description:
        "Copies a library entry into the user's own mappings (a private copy, origin library) — later changes or the deletion of the entry do not affect it. With projectId + fileId the copy is also assigned to that file of the user.",
      area: 'mappings',
      effect: 'write',
      input: z.object({
        libraryId,
        projectId: id('project').optional(),
        fileId: id('project file')
          .optional()
          .describe('A file of that project that needs a mapping.'),
      }),
      output: z.object({
        mapping: z.object({
          id: z.string(),
          name: z.string(),
          version: z.number(),
          link,
        }),
        created: z.boolean(),
        fileId: z.string().nullable(),
        fileStatus: z.string().nullable(),
        fileLink: z.string().nullable(),
      }),
      async run(ctx, input) {
        const target =
          input.projectId && input.fileId
            ? { projectId: input.projectId, projectFileId: input.fileId }
            : undefined;
        const taken = await library.take(ctx.userId, input.libraryId, target);
        return {
          mapping: {
            id: taken.mapping.id,
            name: taken.mapping.name,
            version: taken.mapping.library?.version ?? 1,
            link: `/app/mappings/${encodeURIComponent(taken.mapping.id)}`,
          },
          created: taken.created,
          fileId: taken.file?.id ?? null,
          fileStatus: taken.file?.status ?? null,
          fileLink:
            taken.file && target
              ? fileLink(target.projectId, taken.file.id)
              : null,
        };
      },
      async preview(ctx, input) {
        const entry = await library.get(ctx.userId, input.libraryId);
        return {
          summary: previewText('chat.preview.takeLibraryMapping', {
            name: entry.name,
            version: entry.version,
          }),
          changes: [
            {
              label: previewText('chat.preview.label.mapping'),
              before: null,
              after: entry.name,
            },
          ],
          ...(input.projectId ? { projectId: input.projectId } : {}),
        };
      },
    }),
    defineTool({
      name: 'rate_library_mapping',
      title: 'Bibliotheks-Mapping bewerten',
      description:
        "Rates a library entry with 1–5 stars (the user's own rating; changeable). null removes the rating. Authors cannot rate their own entries.",
      area: 'mappings',
      effect: 'write',
      input: z.object({
        libraryId,
        stars: z.number().int().min(1).max(5).nullable(),
      }),
      output: entryOut,
      async run(ctx, input) {
        return entryOf(
          await library.rate(ctx.userId, input.libraryId, input.stars),
        );
      },
      async preview(ctx, input) {
        const entry = await library.get(ctx.userId, input.libraryId);
        return {
          summary: previewText('chat.preview.rateLibraryMapping', {
            name: entry.name,
          }),
          changes: [
            {
              label: previewText('chat.preview.label.stars'),
              before: entry.myRating === null ? null : String(entry.myRating),
              after: input.stars === null ? null : String(input.stars),
            },
          ],
        };
      },
    }),
    defineTool({
      name: 'publish_mapping',
      title: 'Mapping in Bibliothek veröffentlichen',
      description:
        "Publishes one of the user's own mappings to the public library (or, with libraryId, as a new version of the user's own entry). The spec is scanned for values that look personal (account ids, wallet addresses, e-mails, IBANs, names): removeFindings drops the removable ones; otherwise publishing is refused unless acknowledgeFindings is true. Shown to everyone under the pseudonym (empty = anonymous) — never the user's name or e-mail.",
      area: 'mappings',
      effect: 'write',
      input: z.object({
        mappingId: id('mapping').describe("One of the user's own mappings."),
        libraryId: libraryId
          .optional()
          .describe("Publish as a new version of this entry of the user's."),
        description: z
          .string()
          .trim()
          .max(LIBRARY_LIMITS.maxDescription)
          .optional(),
        pseudonym: z
          .string()
          .trim()
          .max(LIBRARY_LIMITS.maxAuthorName)
          .optional()
          .describe('The public author name; empty = anonymous.'),
        removeFindings: z
          .boolean()
          .default(true)
          .describe('Remove every removable privacy finding first.'),
        acknowledgeFindings: z
          .boolean()
          .default(false)
          .describe('Publish although findings remain (false positives).'),
      }),
      output: entryOut,
      async run(ctx, input) {
        const remove = input.removeFindings
          ? await removablePaths(library, ctx.userId, input)
          : [];
        return entryOf(
          await library.publish(ctx.userId, {
            mappingId: input.mappingId,
            libraryId: input.libraryId,
            remove,
            description: input.description,
            authorName: input.pseudonym,
            confirmed: true,
            acknowledgeFindings: input.acknowledgeFindings,
          }),
        );
      },
      async preview(ctx, input) {
        const review = await library.review(ctx.userId, {
          mappingId: input.mappingId,
          libraryId: input.libraryId,
        });
        const removable = review.findings.filter((f) => f.removable).length;
        const kept = input.removeFindings
          ? review.findings.length - removable
          : review.findings.length;
        return {
          summary: review.target
            ? previewText('chat.preview.publishMappingVersion', {
                name: review.name,
                version: review.target.nextVersion,
              })
            : previewText('chat.preview.publishMapping', { name: review.name }),
          changes: [
            {
              label: previewText('chat.preview.label.libraryEntry'),
              before: null,
              after: review.name,
            },
            {
              label: previewText('chat.preview.label.pseudonym'),
              before: null,
              after: input.pseudonym
                ? input.pseudonym
                : previewText('chat.preview.value.anonymous'),
            },
            {
              label: previewText('chat.preview.label.privacyFindings'),
              before: String(review.findings.length),
              after: previewText(
                kept > 0
                  ? 'chat.preview.value.findingsKept'
                  : 'chat.preview.value.findingsRemoved',
                { count: kept > 0 ? kept : review.findings.length },
              ),
            },
          ],
        };
      },
    }),
    defineTool({
      name: 'delete_library_mapping',
      title: 'Aus Bibliothek entfernen',
      description:
        "Removes the user's own entry from the library. Copies other users took keep working. Someone else's entry cannot be removed (notFound).",
      area: 'mappings',
      effect: 'destructive',
      input: z.object({ libraryId }),
      output: z.object({ removed: z.boolean() }),
      async run(ctx, input) {
        await library.remove(ctx.userId, input.libraryId);
        return { removed: true };
      },
      async preview(ctx, input) {
        const entry = await library.get(ctx.userId, input.libraryId);
        return {
          summary: previewText('chat.preview.deleteLibraryMapping', {
            name: entry.mine ? entry.name : '–',
          }),
          changes: [
            {
              label: previewText('chat.preview.label.libraryEntry'),
              before: entry.mine ? entry.name : '–',
              after: null,
            },
          ],
        };
      },
    }),
  ];
}

/** The removable findings of the reviewed spec (the review is the same the web shows). */
async function removablePaths(
  library: LibraryService,
  userId: string,
  input: { mappingId: string; libraryId?: string },
): Promise<string[]> {
  const review = await library.review(userId, {
    mappingId: input.mappingId,
    libraryId: input.libraryId,
  });
  return scanMappingPrivacy(review.spec)
    .filter((finding) => finding.removable)
    .map((finding) => finding.path);
}
