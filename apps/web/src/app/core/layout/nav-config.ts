import { lucideFolderOpen, lucideSettings } from '@ng-icons/lucide';

export interface NavItem {
  readonly path: string;
  readonly labelKey: string;
  readonly icon: string;
}

/** The main navigation in the header, in order. Icon names must be registered in `NAV_ICONS`. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/app/projects',
    labelKey: 'nav.projects',
    icon: 'lucideFolderOpen',
  },
  {
    path: '/app/settings',
    labelKey: 'nav.settings',
    icon: 'lucideSettings',
  },
];

export const NAV_ICONS = { lucideFolderOpen, lucideSettings };
