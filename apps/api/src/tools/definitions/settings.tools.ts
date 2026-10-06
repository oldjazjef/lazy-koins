import { z } from 'zod';
import { aiReady } from '../../ai/domain/ai-settings';
import { CH_CANTONS } from '../../projects/domain/project';
import { type AnyTool, defineTool } from '../domain/tool';
import { link, projectLink, WORKSPACE_TABS, type ToolServices } from './common';

/**
 * Settings WITHOUT keys (F11.16: "Einstellungen (ohne Schlüssel)"): the output schema has no
 * field for a key, a key hint or a password, so none can leave the tool.
 */
const settingsOut = z.object({
  profile: z.object({
    displayName: z.string(),
    canton: z.string(),
    advisorName: z.string(),
    advisorEmail: z.string(),
    onlineRates: z.boolean(),
  }),
  ai: z.object({
    enabled: z.boolean(),
    provider: z.string(),
    model: z.string(),
    ready: z.boolean(),
  }),
  mail: z.object({ enabled: z.boolean(), ready: z.boolean() }),
  link,
});

/** The pages the assistant may open (F11.14 "navigieren"). */
const PAGES = [
  'dashboard',
  'projects',
  'mappings',
  'wallets',
  'profile',
  'settings/ai',
  'settings/rates',
  'settings/wallets',
  'settings/mail',
  'settings/mcp',
] as const;

/** Profile and settings (F11.0a, F11.0b, F11.1–F11.3) and navigation in the chat. */
export function settingsTools(s: ToolServices): AnyTool[] {
  async function read(userId: string): Promise<z.input<typeof settingsOut>> {
    const [settings, ai, mail] = await Promise.all([
      s.settings.get(userId),
      s.ai.settingsOf(userId),
      s.mail.settings(userId),
    ]);
    return {
      profile: {
        displayName: settings.displayName,
        canton: settings.canton,
        advisorName: settings.advisorName,
        advisorEmail: settings.advisorEmail,
        onlineRates: settings.onlineRates,
      },
      ai: {
        enabled: ai.enabled,
        provider: ai.provider,
        model: ai.model,
        ready: aiReady(ai),
      },
      mail: { enabled: mail.enabled, ready: mail.ready },
      link: '/app/settings',
    };
  }

  return [
    defineTool({
      name: 'get_settings',
      title: 'Einstellungen',
      description:
        "The user's profile (name, canton, Treuhänder) and settings: online rate lookups on/off, whether the AI plugin and the mailer are set up. Never contains keys or passwords.",
      area: 'settings',
      effect: 'readOnly',
      input: z.object({}),
      output: settingsOut,
      run: (ctx) => read(ctx.userId),
    }),
    defineTool({
      name: 'update_settings',
      title: 'Einstellungen ändern',
      description:
        'Changes profile data (name, canton, Treuhänder name/e-mail) or switches online rate lookups (F11.3). Keys cannot be set here.',
      area: 'settings',
      effect: 'write',
      input: z.object({
        displayName: z.string().trim().max(120).optional(),
        canton: z.enum(CH_CANTONS).optional(),
        advisorName: z.string().trim().max(120).optional(),
        advisorEmail: z.union([z.email(), z.literal('')]).optional(),
        onlineRates: z.boolean().optional(),
      }),
      output: settingsOut,
      async run(ctx, input) {
        await s.settings.update(ctx.userId, input);
        return read(ctx.userId);
      },
      async preview(ctx, input) {
        const before = (await read(ctx.userId)).profile;
        const changes = (
          Object.entries(input) as [keyof typeof before, unknown][]
        )
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => ({
            label: key,
            before: String(before[key]),
            after: String(value),
          }));
        return { summary: 'Profil/Einstellungen ändern', changes };
      },
    }),
    defineTool({
      name: 'navigate',
      title: 'Seite öffnen',
      description:
        'Gives the user a link to a page: a project tab (projectId + tab) or an app page. The link is shown in the chat; nothing changes.',
      area: 'ui',
      effect: 'readOnly',
      channels: ['chat'],
      input: z.object({
        projectId: z.string().max(64).optional(),
        tab: z.enum(WORKSPACE_TABS).optional(),
        page: z.enum(PAGES).optional(),
        label: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe('The link text, in German.'),
      }),
      output: z.object({ href: z.string(), label: z.string() }),
      async run(ctx, input) {
        if (input.projectId) {
          await s.projects.get(ctx.userId, input.projectId);
          return {
            href: projectLink(input.projectId, input.tab),
            label: input.label,
          };
        }
        return {
          href: `/app/${input.page ?? 'dashboard'}`,
          label: input.label,
        };
      },
    }),
  ];
}
