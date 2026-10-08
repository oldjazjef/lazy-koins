import type { WorkspaceTab } from '../calculation/components/project-workspace/project-workspace.service';

/**
 * The in-app guide (Hilfe, F11.21): its STRUCTURE lives here, its TEXTS in the message files
 * under `help.*` (`public/i18n/de-CH.json` + `en.json`, same keys — the i18n specs keep them in
 * step). A section is a numbered step of the guide; its texts are
 * `help.sections.<id>.{title,purpose,where}`, `….steps.<item>` and `….tips.<item>` in the order
 * listed here. Change the app → change the help (CLAUDE.md, "Help").
 */

/** Which app a step or link applies to (the desktop = local mode, no account). */
export type HelpMode = 'web' | 'desktop';

export interface HelpItem {
  /** The key below `steps.` / `tips.` of its section. */
  readonly id: string;
  /** Only shown in that app (and then marked "Nur Web-App" / "Nur Desktop-App"). */
  readonly only?: HelpMode;
}

/** An "Öffnen" button: a route of the app (checked against the router by `help-content.spec.ts`). */
export interface HelpLink {
  /** Label `help.links.<id>`. */
  readonly id: string;
  readonly path: string;
  readonly only?: HelpMode;
  /** Only while the mapping library can be opened (`LibraryAvailability`, F5.15–F5.18). */
  readonly needsLibrary?: boolean;
  /** Only in the Electron window (Einstellungen › Speicherort, `desktopOnly`). */
  readonly needsDesktopBridge?: boolean;
}

export const HELP_SECTION_IDS = [
  'setup',
  'project',
  'files',
  'wallets',
  'rates',
  'transactions',
  'checks',
  'corrections',
  'result',
  'exports',
  'advisor',
  'followUp',
  'dashboard',
  'assistant',
  'privacy',
] as const;
export type HelpSectionId = (typeof HELP_SECTION_IDS)[number];

export interface HelpSection {
  readonly id: HelpSectionId;
  readonly steps: readonly HelpItem[];
  readonly tips: readonly HelpItem[];
  readonly links: readonly HelpLink[];
}

const items = (...ids: readonly (string | HelpItem)[]): readonly HelpItem[] =>
  ids.map((id) => (typeof id === 'string' ? { id } : id));

const PROJECTS: HelpLink = { id: 'projects', path: '/app/projects' };

/** The guide, in order: "Schritt N von M" is the position here. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'setup',
    steps: items(
      'profile',
      'advisor',
      'ai',
      'rates',
      'wallets',
      'mail',
      { id: 'storage', only: 'desktop' },
      'pin',
      'summary',
    ),
    tips: items('later', 'again', 'keys'),
    links: [
      { id: 'setup', path: '/app/setup' },
      { id: 'profile', path: '/app/profile' },
      { id: 'settings', path: '/app/settings' },
    ],
  },
  {
    id: 'project',
    steps: items('open', 'facts', 'currency', 'create', 'status'),
    tips: items('tabs', 'currencyChange'),
    links: [{ id: 'projectsNew', path: '/app/projects/new' }, PROJECTS],
  },
  {
    id: 'files',
    steps: items(
      'upload',
      'template',
      'suggestion',
      'noMatch',
      'select',
      'pdf',
      'deactivate',
    ),
    tips: items(
      'mappings',
      { id: 'library', only: 'web' },
      { id: 'libraryDesktop', only: 'desktop' },
      'remove',
      'guide',
    ),
    links: [
      { id: 'files', path: '/app/files' },
      { id: 'mappings', path: '/app/mappings' },
      { id: 'library', path: '/app/mappings/library', needsLibrary: true },
    ],
  },
  {
    id: 'wallets',
    steps: items('add', 'check', 'fetch', 'project', 'manual'),
    tips: items('secret', 'keys'),
    links: [
      { id: 'wallets', path: '/app/wallets' },
      { id: 'walletsNew', path: '/app/wallets/new' },
      { id: 'settingsWallets', path: '/app/settings/wallets' },
    ],
  },
  {
    id: 'rates',
    steps: items(
      'providers',
      'refresh',
      'estv',
      'source',
      'ambiguous',
      'override',
    ),
    tips: items('offline', 'coinGlobal'),
    links: [{ id: 'settingsRates', path: '/app/settings/rates' }, PROJECTS],
  },
  {
    id: 'transactions',
    steps: items('filter', 'detail', 'edit', 'link', 'ai', 'hide'),
    tips: items('locked', 'rule', 'stale'),
    links: [{ id: 'transactions', path: '/app/transactions' }],
  },
  {
    id: 'checks',
    steps: items('hints', 'solve', 'dismiss', 'checks', 'openItems'),
    tips: items('comparison', 'internal'),
    links: [PROJECTS],
  },
  {
    id: 'corrections',
    steps: items('new', 'fill', 'history', 'fromResult'),
    tips: items('reclassify', 'manualHolding'),
    links: [PROJECTS, { id: 'transactions', path: '/app/transactions' }],
  },
  {
    id: 'result',
    steps: items('calculate', 'stale', 'read', 'drill', 'missing'),
    tips: items('auto', 'previous'),
    links: [PROJECTS],
  },
  {
    id: 'exports',
    steps: items('statement', 'documents', 'internal', 'openItems', 'download'),
    tips: items('etax', 'data', 'package'),
    links: [PROJECTS],
  },
  {
    id: 'advisor',
    steps: items('prepare', 'open', 'attach', 'confirm', 'mark'),
    tips: items('noMailer', 'changed', 'template'),
    links: [
      { id: 'profile', path: '/app/profile' },
      { id: 'settingsMail', path: '/app/settings/mail' },
      PROJECTS,
    ],
  },
  {
    id: 'followUp',
    steps: items('open', 'facts', 'choose', 'create'),
    tips: items('files', 'takeOver'),
    links: [PROJECTS],
  },
  {
    id: 'dashboard',
    steps: items('period', 'read', 'holdings', 'rates', 'bell'),
    tips: items('currency', 'notifications'),
    links: [
      { id: 'dashboard', path: '/app/dashboard' },
      { id: 'notifications', path: '/app/notifications' },
    ],
  },
  {
    id: 'assistant',
    steps: items('enable', 'open', 'ask', 'confirm', 'mcp', {
      id: 'mcpDesktop',
      only: 'desktop',
    }),
    tips: items('prompt', 'data'),
    links: [
      { id: 'settingsAi', path: '/app/settings/ai' },
      { id: 'settingsMcp', path: '/app/settings/mcp' },
    ],
  },
  {
    id: 'privacy',
    steps: items(
      'package',
      'account',
      { id: 'storage', only: 'desktop' },
      'pin',
    ),
    tips: items(
      'privacy',
      { id: 'sync', only: 'desktop' },
      { id: 'library', only: 'desktop' },
      { id: 'web', only: 'web' },
    ),
    links: [
      { id: 'profile', path: '/app/profile' },
      {
        id: 'settingsStorage',
        path: '/app/settings/storage',
        only: 'desktop',
        needsDesktopBridge: true,
      },
      { id: 'settingsSystem', path: '/app/settings/system' },
    ],
  },
];

/** Frequent questions (`help.faq.items.<id>.{question,answer}`), under the steps. */
export const HELP_FAQ = [
  'notRecognised',
  'missingFile',
  'wrongRate',
  'stale',
  'keyMissing',
  'readOnly',
  'pin',
] as const;
export type HelpFaqId = (typeof HELP_FAQ)[number];

/** The anchor of the FAQ block (`/app/help#faq`). */
export const HELP_FAQ_ANCHOR = 'faq';

/** The contextual "?" in the project header: the guide's section for each workspace tab. */
export const HELP_SECTION_FOR_TAB: Readonly<
  Record<WorkspaceTab, HelpSectionId>
> = {
  general: 'project',
  files: 'files',
  hints: 'checks',
  wallets: 'wallets',
  rates: 'rates',
  transactions: 'transactions',
  result: 'result',
  checks: 'checks',
  corrections: 'corrections',
  exports: 'exports',
};

export const helpKeys = {
  title: (section: HelpSectionId) => `help.sections.${section}.title`,
  purpose: (section: HelpSectionId) => `help.sections.${section}.purpose`,
  where: (section: HelpSectionId) => `help.sections.${section}.where`,
  step: (section: HelpSectionId, item: string) =>
    `help.sections.${section}.steps.${item}`,
  tip: (section: HelpSectionId, item: string) =>
    `help.sections.${section}.tips.${item}`,
  link: (link: string) => `help.links.${link}`,
  question: (faq: HelpFaqId) => `help.faq.items.${faq}.question`,
  answer: (faq: HelpFaqId) => `help.faq.items.${faq}.answer`,
  only: (mode: HelpMode) => `help.only.${mode}`,
};

/** Every key of a section (for the search and the i18n key check). */
export function sectionKeys(section: HelpSection): string[] {
  return [
    helpKeys.title(section.id),
    helpKeys.purpose(section.id),
    helpKeys.where(section.id),
    ...section.steps.map((item) => helpKeys.step(section.id, item.id)),
    ...section.tips.map((item) => helpKeys.tip(section.id, item.id)),
  ];
}

/** Every key the guide builds at runtime (listed in `i18n-keys.spec.ts`). */
export function allHelpKeys(): string[] {
  return [
    ...HELP_SECTIONS.flatMap((section) => [
      ...sectionKeys(section),
      ...section.links.map((link) => helpKeys.link(link.id)),
    ]),
    ...HELP_FAQ.flatMap((faq) => [
      helpKeys.question(faq),
      helpKeys.answer(faq),
    ]),
    helpKeys.only('web'),
    helpKeys.only('desktop'),
  ];
}
