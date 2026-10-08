import { computed, inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { desktopBridge } from '../../../../core/desktop/desktop-bridge';
import { LibraryAvailability } from '../../../../core/library/library-availability.service';
import { SetupStateService } from '../../../../core/setup/setup-state.service';
import {
  HELP_FAQ,
  HELP_FAQ_ANCHOR,
  HELP_SECTIONS,
  type HelpFaqId,
  type HelpItem,
  type HelpLink,
  type HelpMode,
  type HelpSectionId,
  helpKeys,
  sectionKeys,
} from '../../help-content';

/** A section as shown: its place in the guide and only what applies to this app. */
export interface HelpSectionView {
  readonly id: HelpSectionId;
  /** 1-based position in the whole guide ("Schritt N von M"), also while searching. */
  readonly number: number;
  readonly steps: readonly HelpItem[];
  readonly tips: readonly HelpItem[];
  readonly links: readonly HelpLink[];
}

/** A scroll request: the section (or `faq`) and a counter, so the same target scrolls again. */
export interface HelpTarget {
  readonly id: string;
  readonly seq: number;
}

/** Lower case without accents, so "prufung" finds "Prüfung". */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Every word of the query occurs in the text (both normalised). */
export function matches(text: string, query: string): boolean {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  return words.every((word) => text.includes(word));
}

/**
 * The help page (F11.21): the guide filtered for this app (web or desktop, library or not), the
 * search over the translated texts, and which section to scroll to and mark.
 */
@Injectable()
export class HelpPageService {
  private readonly translate = inject(TranslateService);
  private readonly library = inject(LibraryAvailability);
  /** The desktop app runs without an account (local mode); the web app always has one. */
  readonly mode: HelpMode = inject(AuthService).hasAccount ? 'web' : 'desktop';
  private readonly bridge = desktopBridge() !== null;
  /** F11.0s: the wizard is still open — the page offers the way back to it. */
  readonly setupIncomplete = inject(SetupStateService).incomplete;

  readonly query = signal('');
  /** The section the user jumped to (TOC or `#fragment`), marked for a moment. */
  readonly target = signal<HelpTarget | null>(null);
  private seq = 0;

  private applies(item: { readonly only?: HelpMode }): boolean {
    return !item.only || item.only === this.mode;
  }

  private linkApplies(link: HelpLink): boolean {
    return (
      this.applies(link) &&
      (!link.needsLibrary || this.library.available()) &&
      (!link.needsDesktopBridge || this.bridge)
    );
  }

  /** The whole guide for this app, numbered. */
  readonly sections = computed<readonly HelpSectionView[]>(() =>
    HELP_SECTIONS.map((section, index) => ({
      id: section.id,
      number: index + 1,
      steps: section.steps.filter((item) => this.applies(item)),
      tips: section.tips.filter((item) => this.applies(item)),
      links: section.links.filter((link) => this.linkApplies(link)),
    })),
  );
  readonly total = HELP_SECTIONS.length;

  /** The searchable text of every section and question, in the current language. */
  private readonly texts = computed(() => {
    // Re-translate after a language switch (and once the messages are loaded).
    this.translate.currentLang();
    const text = (keys: readonly string[]) =>
      normalise(keys.map((key) => this.translate.instant(key)).join(' '));
    const sections = new Map(
      this.sections().map((view) => [view.id, text(sectionKeys(view))]),
    );
    const faq = new Map(
      HELP_FAQ.map((id) => [
        id,
        text([helpKeys.question(id), helpKeys.answer(id)]),
      ]),
    );
    return { sections, faq };
  });

  readonly searching = computed(() => this.query().trim() !== '');

  readonly visibleSections = computed(() => {
    const query = this.query();
    if (!this.searching()) return this.sections();
    const texts = this.texts().sections;
    return this.sections().filter((view) =>
      matches(texts.get(view.id) ?? '', query),
    );
  });

  readonly visibleFaq = computed<readonly HelpFaqId[]>(() => {
    const query = this.query();
    if (!this.searching()) return HELP_FAQ;
    const texts = this.texts().faq;
    return HELP_FAQ.filter((id) => matches(texts.get(id) ?? '', query));
  });

  readonly nothingFound = computed(
    () => this.visibleSections().length === 0 && this.visibleFaq().length === 0,
  );

  /** Whether an anchor is a place on this page (a section or the FAQ). */
  isTarget(id: string | null | undefined): id is string {
    return (
      id === HELP_FAQ_ANCHOR ||
      HELP_SECTIONS.some((section) => section.id === id)
    );
  }

  /** Jump to a section (or the FAQ): a search that hides it is cleared first. */
  reveal(id: string): void {
    if (!this.isTarget(id)) return;
    const hidden =
      id === HELP_FAQ_ANCHOR
        ? this.visibleFaq().length === 0
        : !this.visibleSections().some((view) => view.id === id);
    if (hidden) this.query.set('');
    this.target.set({ id, seq: ++this.seq });
  }
}
