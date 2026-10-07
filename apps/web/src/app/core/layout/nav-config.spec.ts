import { NAV_ICONS, NAV_ITEMS, navItemsFor } from './nav-config';

describe('main navigation', () => {
  it('shows the mapping library only in the web app (F5.15), not on the desktop', () => {
    expect(navItemsFor(true).map((item) => item.path)).toContain(
      '/app/library',
    );
    expect(navItemsFor(false).map((item) => item.path)).not.toContain(
      '/app/library',
    );
    expect(navItemsFor(false)).toHaveLength(NAV_ITEMS.length - 1);
  });

  it('registers every icon it uses', () => {
    for (const item of NAV_ITEMS) {
      expect(Object.keys(NAV_ICONS)).toContain(item.icon);
    }
  });
});
