import { isNavActive, NAV_ICONS, NAV_ITEMS, navItemsFor } from './nav-config';

const mappings = (webApp: boolean) =>
  navItemsFor(webApp).find((item) => item.path === '/app/mappings');

describe('main navigation', () => {
  it('lists the library under Mappings (user rule) and only in the web app (F5.15)', () => {
    expect(mappings(true)?.children?.map((child) => child.path)).toEqual([
      '/app/mappings',
      '/app/mappings/library',
    ]);
    // Desktop: no library, so Mappings is a plain link without a menu.
    expect(mappings(false)?.children).toBeUndefined();
    expect(navItemsFor(false)).toHaveLength(NAV_ITEMS.length);
  });

  it('marks the most specific sub-item as current', () => {
    const children = mappings(true)?.children ?? [];
    const [mine, library] = children;
    if (!mine || !library) throw new Error('missing sub-items');
    expect(isNavActive('/app/mappings/abc', mine, children)).toBe(true);
    expect(isNavActive('/app/mappings/library/x', mine, children)).toBe(false);
    expect(
      isNavActive('/app/mappings/library?q=kraken', library, children),
    ).toBe(true);
    expect(isNavActive('/app/mappingsX', mine, children)).toBe(false);
  });

  it('registers every icon it uses', () => {
    for (const item of NAV_ITEMS.flatMap((item) => [
      item,
      ...(item.children ?? []),
    ])) {
      expect(Object.keys(NAV_ICONS)).toContain(item.icon);
    }
  });
});
