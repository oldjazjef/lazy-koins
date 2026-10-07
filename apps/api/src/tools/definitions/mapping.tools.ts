import { z } from 'zod';
import { mappingJsonSchema } from '@lazykoins/engine';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { MAPPING_ORIGINS } from '../../mappings/domain/import-mapping';
import { type AnyTool, defineTool } from '../domain/tool';
import { previewText } from '../domain/preview-texts';
import { id, link, type ToolServices } from './common';

const mappingOut = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(),
  origin: z.enum(MAPPING_ORIGINS),
  version: z.number(),
  updatedAt: z.string(),
  link,
});

function mappingOf(mapping: ImportMapping) {
  return {
    id: mapping.id,
    name: mapping.name,
    platform: mapping.platform,
    origin: mapping.origin,
    version: mapping.version,
    updatedAt: mapping.updatedAt,
    link: `/app/mappings/${encodeURIComponent(mapping.id)}`,
  };
}

const spec = z
  .record(z.string(), z.unknown())
  .describe(
    'A mapping spec (JSON). Call get_mapping_schema first for the exact shape; the API validates it.',
  );

/** Mapping specs (F5.11, F5.12, F11.0). */
export function mappingTools(s: ToolServices): AnyTool[] {
  return [
    defineTool({
      name: 'list_mappings',
      title: 'Mappings auflisten',
      description:
        'All mappings of the user (they apply to every project): name, platform, origin (ai | manual | copied) and how many files/projects use them.',
      area: 'mappings',
      effect: 'readOnly',
      input: z.object({}),
      output: z.object({
        mappings: z.array(
          mappingOut.extend({
            filesUsing: z.number(),
            projectsUsing: z.number(),
          }),
        ),
      }),
      async run(ctx) {
        const list = await s.mappings.listMine(ctx.userId);
        return {
          mappings: list.map((entry) => ({
            ...mappingOf(entry.mapping),
            filesUsing: entry.filesUsing,
            projectsUsing: entry.projectsUsing,
          })),
        };
      },
    }),
    defineTool({
      name: 'get_mapping_schema',
      title: 'Mapping-Schema',
      description:
        'The JSON Schema of a mapping spec (every field described) — read it before create_mapping or update_mapping.',
      area: 'mappings',
      effect: 'readOnly',
      input: z.object({}),
      output: z.object({ schema: z.record(z.string(), z.unknown()) }),
      run() {
        return Promise.resolve({ schema: mappingJsonSchema() });
      },
    }),
    defineTool({
      name: 'get_mapping',
      title: 'Mapping anzeigen',
      description: 'One mapping with its spec (JSON).',
      area: 'mappings',
      effect: 'readOnly',
      input: z.object({ mappingId: id('mapping') }),
      output: mappingOut.extend({ spec: z.record(z.string(), z.unknown()) }),
      async run(ctx, input) {
        const mapping = await s.mappings.get(ctx.userId, input.mappingId);
        return {
          ...mappingOf(mapping),
          spec: mapping.spec as unknown as Record<string, unknown>,
        };
      },
    }),
    defineTool({
      name: 'create_mapping',
      title: 'Mapping anlegen',
      description:
        'Stores a new mapping spec (origin "ai"). Files with a matching fingerprint are read with it on their next upload; existing files can be assigned with assign_file.',
      area: 'mappings',
      effect: 'write',
      input: z.object({ spec }),
      output: mappingOut,
      async run(ctx, input) {
        return mappingOf(await s.mappings.create(ctx.userId, input.spec, 'ai'));
      },
      async preview(_ctx, input) {
        const name =
          typeof input.spec['name'] === 'string' ? input.spec['name'] : '–';
        return {
          summary: previewText('chat.preview.createMapping', { name }),
          changes: [
            {
              label: previewText('chat.preview.label.mapping'),
              before: null,
              after: name,
            },
          ],
        };
      },
    }),
    defineTool({
      name: 'update_mapping',
      title: 'Mapping ändern',
      description:
        'Replaces the spec of a mapping. Files already read keep their result until reapply_mapping.',
      area: 'mappings',
      effect: 'write',
      input: z.object({ mappingId: id('mapping'), spec }),
      output: mappingOut.extend({ filesUsing: z.number() }),
      async run(ctx, input) {
        const updated = await s.mappings.update(
          ctx.userId,
          input.mappingId,
          input.spec,
        );
        return {
          ...mappingOf(updated.mapping),
          filesUsing: updated.filesUsing,
        };
      },
      async preview(ctx, input) {
        const mapping = await s.mappings.get(ctx.userId, input.mappingId);
        return {
          summary: previewText('chat.preview.updateMapping', {
            name: mapping.name,
            from: mapping.version,
            to: mapping.version + 1,
          }),
          changes: [
            {
              label: previewText('chat.preview.label.version'),
              before: String(mapping.version),
              after: String(mapping.version + 1),
            },
          ],
        };
      },
    }),
    defineTool({
      name: 'reapply_mapping',
      title: 'Mapping erneut anwenden',
      description:
        'Reads every file that uses the mapping again (files of closed projects are skipped).',
      area: 'mappings',
      effect: 'write',
      input: z.object({ mappingId: id('mapping') }),
      output: z.object({ reapplied: z.number(), skippedClosed: z.number() }),
      async run(ctx, input) {
        return s.mappings.reapply(ctx.userId, input.mappingId);
      },
    }),
    defineTool({
      name: 'delete_mapping',
      title: 'Mapping löschen',
      description:
        'Deletes a mapping; its files go back to needs_mapping. Refused while a closed project uses it.',
      area: 'mappings',
      effect: 'destructive',
      input: z.object({ mappingId: id('mapping') }),
      output: z.object({ filesReset: z.number() }),
      async run(ctx, input) {
        return {
          filesReset: await s.mappings.remove(ctx.userId, input.mappingId),
        };
      },
      async preview(ctx, input) {
        const mapping = await s.mappings.get(ctx.userId, input.mappingId);
        return {
          summary: previewText('chat.preview.deleteMapping', {
            name: mapping.name,
          }),
          changes: [
            {
              label: previewText('chat.preview.label.mapping'),
              before: mapping.name,
              after: null,
            },
          ],
        };
      },
    }),
  ];
}
