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
  },
  {
    path: '/app/library',
    labelKey: 'nav.library',
    icon: 'lucideLibraryBig',
    webOnly: true,
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

/** The main navigation for this app: without the web-only entries on the desktop. */
export function navItemsFor(webApp: boolean): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => webApp || !item.webOnly);
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
