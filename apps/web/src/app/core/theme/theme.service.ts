import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'lk-theme';

function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Light is the app's default but every dark
 * token already exists in styles.css under `:root.dark` — this just decides which one applies,
 * persists the choice, and falls back to the OS preference the first time a visitor shows up.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly theme = signal<Theme>(resolveInitialTheme());
  readonly current = this.theme.asReadonly();

  constructor() {
    effect(() => {
      const theme = this.theme();
      document.documentElement.classList.toggle('dark', theme === 'dark');
      localStorage.setItem(STORAGE_KEY, theme);
    });
  }

  toggle(): void {
    this.theme.update((current) => (current === 'dark' ? 'light' : 'dark'));
  }
}
