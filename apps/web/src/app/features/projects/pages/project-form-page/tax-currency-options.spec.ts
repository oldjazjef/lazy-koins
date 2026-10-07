import { TAX_CURRENCIES } from '../../../../core/api/api.types';
import { taxCurrencyOptions } from './tax-currency-options';

describe('taxCurrencyOptions (F4.1a)', () => {
  it('offers the country default first, then CHF, EUR, USD, GBP', () => {
    const { common, others } = taxCurrencyOptions('CH');
    expect(common).toEqual(['CHF', 'EUR', 'USD', 'GBP']);
    expect(others).not.toContain('CHF');
    expect([...common, ...others].sort()).toEqual([...TAX_CURRENCIES].sort());
  });

  it("keeps the project's own currency among the first", () => {
    expect(taxCurrencyOptions('CH', 'SEK').common).toEqual([
      'CHF',
      'SEK',
      'EUR',
      'USD',
      'GBP',
    ]);
    expect(taxCurrencyOptions('CH', 'SEK').others).not.toContain('SEK');
  });
});
