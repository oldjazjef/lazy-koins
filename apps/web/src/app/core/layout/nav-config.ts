import {
  lucideFileJson,
  lucideFolderOpen,
  lucideLayoutDashboard,
  lucideLibraryBig,
  lucideSettings,
  lucideUserRound,
  lucideWallet,
} from '@ng-icons/lucide';

export interface NavItem {
  readonly path: string;
  readonly labelKey: string;
  readonly icon: string;
  /**
   * Only while the mapping library can be used (F5.15–F5.18: the web app's own library, or on
   * the desktop a linked web deployment's — `LibraryAvailability`).
   */
  readonly needsLibrary?: boolean;
  /**
   * Sub-items, listed under the entry in the sidebar (expandable, like etx). User rule: the
   * library belongs to Mappings.
   */
  readonly children?: readonly NavItem[];
}

/**
 * The main navigation in the sidebar, in order — its single source (`app-shell.html` only renders
 * it). Icon names must be registered in `NAV_ICONS`.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/app/dashboard',
    labelKey: 'nav.dashboard',
    icon: 'lucideLayoutDashboard',
  },
  {
    path: '/app/projects',
    labelKey: 'nav.projects',
    icon: 'lucideFolderOpen',
  },
  {
    path: '/app/mappings',
    labelKey: 'nav.mappings',
    icon: 'lucideFileJson',
    children: [
      {
        path: '/app/mappings',
        labelKey: 'nav.myMappings',
        icon: 'lucideFileJson',
      },
      {
        path: '/app/mappings/library',
        labelKey: 'nav.library',
        icon: 'lucideLibraryBig',
        needsLibrary: true,
      },
    ],
  },
  {
    path: '/app/wallets',
    labelKey: 'nav.wallets',
    icon: 'lucideWallet',
  },
];

/** The user menu in the sidebar's footer (ANFORDERUNGEN §11): Profil and Einstellungen. */
export const USER_MENU_ITEMS: readonly NavItem[] = [
  {
    path: '/app/profile',
    labelKey: 'nav.profile',
    icon: 'lucideUserRound',
  },
  {
    path: '/app/settings',
    labelKey: 'nav.settings',
    icon: 'lucideSettings',
  },
];

/**
 * The main navigation for this app: without the library entry while there is no library to open
 * (a desktop without a linked web library). An entry left with a single sub-item (Mappings
 * then) becomes a plain link.
 */
export function navItemsFor(libraryAvailable: boolean): readonly NavItem[] {
  const allowed = (item: NavItem) => libraryAvailable || !item.needsLibrary;
  return NAV_ITEMS.filter(allowed).map((item) => {
    const children = item.children?.filter(allowed) ?? [];
    const { children: _all, ...plain } = item;
    return children.length > 1 ? { ...plain, children } : plain;
  });
}

export const NAV_ICONS = {
  lucideFileJson,
  lucideFolderOpen,
  lucideLayoutDashboard,
  lucideLibraryBig,
  lucideSettings,
  lucideUserRound,
  lucideWallet,
};

/**
 * Whether a navigation entry is the current one: the URL lies under its path and not under a
 * more specific sibling's ("Meine Mappings" vs. "Bibliothek" below `/app/mappings`).
 */
export function isNavActive(
  url: string,
  item: NavItem,
  siblings: readonly NavItem[] = [],
): boolean {
  const current = url.split(/[?#]/)[0] ?? '';
  const under = (path: string) =>
    current === path || current.startsWith(`${path}/`);
  return (
    under(item.path) &&
    !siblings.some(
      (other) =>
        other !== item &&
        other.path.length > item.path.length &&
        under(other.path),
    )
  );
}

/**
 * Whether a top-level row is highlighted: an entry without sub-items when it is current; an entry
 * with sub-items only while they cannot be seen (group closed, sidebar collapsed to icons) —
 * otherwise the sub-item carries the highlight, never both.
 */
export function isNavRowActive(
  url: string,
  item: NavItem,
  subItemsVisible: boolean,
): boolean {
  if (!isNavActive(url, item)) return false;
  return !item.children?.length || !subItemsVisible;
}
