import {
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  defaultSystemPrompt,
  isDefaultPrompt,
  SAFETY_RULES,
  safetyRules,
} from './assistant-prompt';

describe('assistant prompt per language (F11.15, F11.2)', () => {
  it('keeps the German default and rules', () => {
    expect(defaultSystemPrompt('de-CH')).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(safetyRules('de-CH')).toBe(SAFETY_RULES);
    const system = buildSystemPrompt(null, {}, '2026-10-07');
    expect(system).toContain('Antworte auf Deutsch (Schweiz)');
    expect(system).toContain('Heute ist 2026-10-07.');
  });

  it('answers in English for an English user, with the fixed rules in English', () => {
    const system = buildSystemPrompt(
      null,
      { projectId: 'p1', projectName: 'Taxes 2025', projectTaxYear: 2025 },
      '2026-10-07',
      'en',
    );
    expect(system).toContain('Answer in English');
    expect(system).toContain('Fixed rules (not negotiable');
    expect(system).toContain('App language: English');
    expect(system).toContain(
      'Current project: Taxes 2025 (id p1, tax year 2025)',
    );
    expect(system).not.toContain('Antworte auf Deutsch');
  });

  it('tells the model the language also with an own prompt', () => {
    const system = buildSystemPrompt('Be brief.', {}, '2026-10-07', 'en');
    expect(system.startsWith('Be brief.')).toBe(true);
    expect(system).toContain('App language: English');
  });

  it('recognises every default as "the default"', () => {
    expect(isDefaultPrompt(defaultSystemPrompt('en').trim())).toBe(true);
    expect(isDefaultPrompt(DEFAULT_SYSTEM_PROMPT.trim())).toBe(true);
    expect(isDefaultPrompt('Be brief.')).toBe(false);
  });
});
