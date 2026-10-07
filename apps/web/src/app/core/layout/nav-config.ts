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
  /** Only in the web app (F5.15: the mapping library is shared by the users of a server). */
  readonly webOnly?: boolean;
  /** Sub-items: the entry opens a menu with them (user rule: the library belongs to Mappings). */
  readonly children?: readonly NavItem[];
}

/** The main navigation in the header, in order. Icon names must be registered in `NAV_ICONS`. */
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
        webOnly: true,
      },
    ],
  },
  {
    path: '/app/wallets',
    labelKey: 'nav.wallets',
    icon: 'lucideWallet',
  },
];

/** The user menu at the top right (ANFORDERUNGEN §11): Profil and Einstellungen. */
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
 * The main navigation for this app: without the web-only entries on the desktop. An entry left
 * with a single sub-item (Mappings on the desktop) becomes a plain link.
 */
export function navItemsFor(webApp: boolean): readonly NavItem[] {
  const allowed = (item: NavItem) => webApp || !item.webOnly;
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
