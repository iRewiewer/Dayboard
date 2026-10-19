import { DEFAULT_THEME, THEME_COLORS } from './domain';
import type { ThemeColor, ThemePreference } from './domain';

export const THEME_OPTIONS: { id: ThemeColor; name: string; swatch: string }[] = [
  { id: 'blood-red', name: 'Blood red', swatch: '#8f1725' },
  { id: 'crimson-red', name: 'Crimson red', swatch: '#dc264b' },
  { id: 'green', name: 'Green', swatch: '#29805c' },
  { id: 'purple', name: 'Purple', swatch: '#8050b5' },
  { id: 'violet', name: 'Violet', swatch: '#6c5be0' },
  { id: 'pink', name: 'Pink', swatch: '#d45b91' },
  { id: 'orange', name: 'Orange', swatch: '#eb893b' },
  { id: 'yellow', name: 'Yellow', swatch: '#e3bc3c' },
  { id: 'lime', name: 'Lime', swatch: '#96be36' },
  { id: 'fuchsia', name: 'Fuchsia', swatch: '#cd44c8' },
  { id: 'cyan', name: 'Cyan', swatch: '#38acc0' },
  { id: 'navy-blue', name: 'Navy blue', swatch: '#36528c' },
  { id: 'light-blue', name: 'Light blue', swatch: '#74afe6' },
];

export function cacheTheme(theme: ThemePreference): void {
  try { localStorage.setItem('dayboard-theme', JSON.stringify(theme)); } catch { /* The JSON file remains authoritative. */ }
}

export function applyTheme(theme: ThemePreference, cache = false): void {
  const root = document.documentElement;
  root.dataset.mode = theme.mode;
  root.dataset.accent = theme.color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.mode === 'dark' ? '#111318' : '#f8fafc');
  if (cache) cacheTheme(theme);
}

export function initializeTheme(): void {
  try {
    const cached = JSON.parse(localStorage.getItem('dayboard-theme') ?? 'null') as Partial<ThemePreference> | null;
    if (cached && (cached.mode === 'light' || cached.mode === 'dark') && THEME_COLORS.includes(cached.color as ThemeColor)) {
      applyTheme(cached as ThemePreference);
      return;
    }
  } catch { /* Use the default while loading saved settings. */ }
  applyTheme(DEFAULT_THEME);
}
