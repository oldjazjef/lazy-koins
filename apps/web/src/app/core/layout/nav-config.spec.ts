import {
  HELP_NAV_ITEM,
  isNavActive,
  isNavRowActive,
  NAV_ICONS,
  NAV_ITEMS,
  navItemsFor,
} from './nav-config';

const mappings = (libraryAvailable: boolean) =>
  navItemsFor(libraryAvailable).find((item) => item.path === '/app/mappings');

describe('main navigation', () => {
  it('lists the library under Mappings (user rule) only while it can be used (F5.15, F5.18)', () => {
    expect(mappings(true)?.children?.map((child) => child.path)).toEqual([
      '/app/mappings',
      '/app/mappings/library',
    ]);
    // Desktop without a linked web library: Mappings is a plain link without a menu.
    expect(mappings(false)?.children).toBeUndefined();
    // Everything but "Administration" (admins only).
    expect(navItemsFor(false)).toHaveLength(NAV_ITEMS.length - 1);
  });

  it('shows "Administration" with its pages to platform admins only', () => {
    const admin = (isAdmin: boolean) =>
      navItemsFor(true, isAdmin).find((item) => item.path === '/app/admin');
    expect(admin(false)).toBeUndefined();
    expect(admin(true)?.children?.map((child) => child.path)).toEqual([
      '/app/admin',
      '/app/admin/users',
      '/app/admin/library',
      '/app/admin/audit',
    ]);
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

  it('highlights a parent row only while its sub-items are not visible', () => {
    const parent = mappings(true);
    const projects = navItemsFor(true).find(
      (item) => item.path === '/app/projects',
    );
    if (!parent || !projects) throw new Error('missing entries');
    expect(isNavRowActive('/app/mappings/library', parent, true)).toBe(false);
    // Group closed or sidebar collapsed to icons: the parent says where the user is.
    expect(isNavRowActive('/app/mappings/library', parent, false)).toBe(true);
    expect(isNavRowActive('/app/projects/p1', projects, true)).toBe(true);
    expect(isNavRowActive('/app/dashboard', projects, false)).toBe(false);
    // Desktop without a library: Mappings has no sub-items and is a plain row.
    const plain = mappings(false);
    if (!plain) throw new Error('missing Mappings');
    expect(isNavRowActive('/app/mappings/abc', plain, true)).toBe(true);
  });

  it('registers every icon it uses', () => {
    for (const item of [
      ...NAV_ITEMS.flatMap((item) => [item, ...(item.children ?? [])]),
      HELP_NAV_ITEM,
    ]) {
      expect(Object.keys(NAV_ICONS)).toContain(item.icon);
    }
  });

  it('keeps "Hilfe" out of the main list: it sits above the user menu (F11.21)', () => {
    expect(HELP_NAV_ITEM.path).toBe('/app/help');
    expect(HELP_NAV_ITEM.labelKey).toBe('nav.help');
    expect(NAV_ITEMS.map((item) => item.path)).not.toContain('/app/help');
  });
});
