import type { TranslateService } from '@ngx-translate/core';
import {
  TOOL_ERROR_CODES,
  type ChatEventView,
  type ProposalValue,
  type ProposalView,
} from '../api/assistant.types';

/**
 * F11.2: a card value in the user's language. A string is shown as it is (data, or the German
 * sentence of a proposal stored before); a key is translated, its values first (one level of
 * nesting: `{{kind}}` = `exports.kind.simple_pdf`).
 */
export function proposalText(
  translate: TranslateService,
  value: ProposalValue,
): string {
  if (typeof value === 'string') return value;
  const params: Record<string, string | number> = {};
  for (const [name, param] of Object.entries(value.params ?? {})) {
    params[name] =
      typeof param === 'object' ? proposalText(translate, param) : param;
  }
  return translate.instant(value.key, params);
}

export interface ShownChange {
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** What a proposal card shows, translated. */
export interface ShownProposal {
  readonly summary: string;
  readonly changes: readonly ShownChange[];
  /** failed: the reason in the user's language (by the tool's error code). */
  readonly error: string | null;
}

/** The translated reason of a failed tool run — never the API's English message. */
export function toolErrorText(
  translate: TranslateService,
  code: string | undefined,
): string {
  const known = (TOOL_ERROR_CODES as readonly string[]).includes(code ?? '');
  return translate.instant(`chat.proposal.errors.${known ? code : 'failed'}`);
}

export function shownProposal(
  translate: TranslateService,
  proposal: ProposalView,
): ShownProposal {
  const text = (value: ProposalValue | null) =>
    value === null ? null : proposalText(translate, value);
  const error = proposal.outcome?.error;
  return {
    summary: proposalText(translate, proposal.summary),
    changes: proposal.changes.map((change) => ({
      label: proposalText(translate, change.label),
      before: text(change.before),
      after: text(change.after),
    })),
    error: error ? toolErrorText(translate, error.code) : null,
  };
}

/** The muted line of an event row ("Ausgeführt: Kurs überschreiben"). */
export function eventText(
  translate: TranslateService,
  event: ChatEventView,
): string {
  return translate.instant(`chat.event.${event.outcome}`, {
    title: event.title,
    reason: toolErrorText(translate, event.errorCode),
  });
}
