import { chRules, rulesInLanguage, withTaxCurrency } from './country-rules';

describe('country labels per language (F10.3, F11.2)', () => {
  it('keeps the German labels for de-CH and unknown languages', () => {
    expect(rulesInLanguage(chRules, 'de-CH')).toBe(chRules);
    expect(rulesInLanguage(chRules, 'fr')).toBe(chRules);
  });

  it('has English labels with the official German term where needed', () => {
    const en = rulesInLanguage(withTaxCurrency(chRules, 'EUR'), 'en');
    expect(en.labels.wealthTitle).toBe('Tax value at 31.12.');
    expect(en.labels.securitiesList).toContain('(Wertschriften-');
    expect(en.labels.formReference('ZH')).toContain('canton ZH');
    expect(en.labels.categories.earn_gap).toBe('Earn gap (difference method)');
    // Only the labels change — never a figure.
    expect(en.homeCurrency).toBe('EUR');
    expect(en.dustThreshold).toBe(chRules.dustThreshold);
    expect(Object.keys(en.labels.categories)).toEqual(
      Object.keys(chRules.labels.categories),
    );
  });
});
