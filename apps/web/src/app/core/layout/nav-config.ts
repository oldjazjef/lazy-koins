import {
  lucideFileJson,
  lucideFolderOpen,
  lucideLayoutDashboard,
  lucideSettings,
  lucideUserRound,
} from '@ng-icons/lucide';

export interface NavItem {
  readonly path: string;
  readonly labelKey: string;
  readonly icon: string;
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

export const NAV_ICONS = {
  lucideFileJson,
  lucideFolderOpen,
  lucideLayoutDashboard,
  lucideSettings,
  lucideUserRound,
};
