import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import type { ChatMessageView, ProposalView } from '../api/assistant.types';
import { ChatMessage } from './chat-message';
import { ChatService } from './chat.service';
import { ProposalCard } from './proposal-card';

/** The real message files: the card must read right in both languages (F11.2). */
const I18N_DIR = [
  join(process.cwd(), 'public', 'i18n'),
  join(process.cwd(), 'apps', 'web', 'public', 'i18n'),
].find((dir) => existsSync(dir));
const messages = (locale: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(I18N_DIR ?? '', `${locale}.json`), 'utf8'),
  ) as Record<string, unknown>;

/** A proposal as the API sends it: keys + values, no sentence. */
const proposal = (overrides: Partial<ProposalView> = {}): ProposalView => ({
  id: 'pr1',
  tool: 'set_price_override',
  title: 'Override price',
  effect: 'write',
  summary: {
    key: 'chat.preview.priceOverride',
    params: { asset: 'DOT', date: '2025-12-31' },
  },
  changes: [
    {
      label: {
        key: 'chat.preview.label.price',
        params: { asset: 'DOT', unit: 'CHF' },
      },
      before: { key: 'chat.preview.value.noPrice' },
      after: {
        key: 'chat.preview.value.override',
        params: { price: '4.50', unit: 'CHF' },
      },
    },
    {
      label: { key: 'chat.preview.label.kind' },
      before: null,
      after: { key: 'bookings.kind.income_staking' },
    },
    {
      label: { key: 'chat.preview.label.done' },
      before: { key: 'chat.preview.value.no' },
      after: { key: 'chat.preview.value.yes' },
    },
  ],
  projectId: null,
  status: 'pending',
  outcome: null,
  decidedAt: null,
  ...overrides,
});

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTranslateService(),
      {
        provide: ChatService,
        useValue: {
          deciding: signal(false),
          confirm: vi.fn(),
          cancel: vi.fn(),
          navigated: vi.fn(),
        },
      },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('de-CH', messages('de-CH'));
  translate.setTranslation('en', messages('en'));
  return translate;
}

async function render<T>(
  component: new (...args: never[]) => T,
  name: string,
  value: unknown,
  translate: TranslateService,
  locale: string,
): Promise<{ text: () => string; switchTo: (l: string) => Promise<void> }> {
  translate.use(locale);
  const fixture = TestBed.createComponent(component);
  fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  await fixture.whenStable();
  return {
    text: () =>
      ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(
        /\s+/g,
        ' ',
      ),
    switchTo: async (l: string) => {
      translate.use(l);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    },
  };
}

describe('proposal card (F11.14, F11.2)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders summary and lines in German and in English, and follows a switch', async () => {
    const translate = setup();
    const card = await render(
      ProposalCard,
      'proposal',
      proposal(),
      translate,
      'de-CH',
    );
    expect(card.text()).toContain('Kurs von DOT am 2025-12-31 überschreiben');
    expect(card.text()).toContain('Kurs DOT (CHF)');
    expect(card.text()).toContain('kein Kurs');
    expect(card.text()).toContain('4.50 CHF (Override)');
    expect(card.text()).toContain('Ertrag');
    expect(card.text()).toContain('nein');

    await card.switchTo('en');
    const english = card.text();
    expect(english).toContain('Override the price of DOT on 2025-12-31');
    expect(english).toContain('Price DOT (CHF)');
    expect(english).toContain('no price');
    expect(english).toContain('4.50 CHF (override)');
    expect(english).toContain('Income: staking');
    expect(english).toContain('Run');
    expect(english).not.toMatch(/überschreiben|kein Kurs|Ausführen/);
  });

  it('shows a failure by its code in the user language, never the API message', async () => {
    const translate = setup();
    const card = await render(
      ProposalCard,
      'proposal',
      proposal({
        status: 'failed',
        outcome: {
          error: {
            code: 'conflict',
            message: 'The project is closed: reopen it first, then change it',
          },
        },
      }),
      translate,
      'en',
    );
    expect(card.text()).toContain(
      'Failed: conflicts with the current state (e.g. the project is closed)',
    );
    expect(card.text()).not.toContain('reopen it first, then change it');
    await card.switchTo('de-CH');
    expect(card.text()).toContain('passt nicht zum aktuellen Stand');
  });

  it('keeps a proposal stored before as it was (a German sentence)', async () => {
    const translate = setup();
    const card = await render(
      ProposalCard,
      'proposal',
      proposal({
        summary: 'Kurs von DOT am 2025-12-31 überschreiben',
        changes: [{ label: 'Kurs DOT (CHF)', before: null, after: '4.5' }],
      }),
      translate,
      'en',
    );
    expect(card.text()).toContain('Kurs von DOT am 2025-12-31 überschreiben');
    expect(card.text()).toContain('Kurs DOT (CHF)');
  });

  it('renders an event row in the user language', async () => {
    const translate = setup();
    const message: ChatMessageView = {
      id: 'm1',
      role: 'event',
      content: 'Executed: Override price (set_price_override)',
      createdAt: '2026-10-07T10:00:00.000Z',
      attachments: [],
      proposals: [],
      toolsUsed: [],
      event: { outcome: 'executed', title: 'Override price' },
    };
    const row = await render(ChatMessage, 'message', message, translate, 'en');
    expect(row.text()).toContain('Done: Override price');
    await row.switchTo('de-CH');
    expect(row.text()).toContain('Ausgeführt: Override price');
  });
});
