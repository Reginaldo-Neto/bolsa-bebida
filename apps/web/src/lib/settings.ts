import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';
export type Locale = 'pt-PT' | 'en';

interface SettingsState {
  theme: Theme;
  locale: Locale;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLocale: (locale: Locale) => void;
}

/**
 * Spec 11.1 says the interface is dark by default, and the party is at night,
 * so that is where it starts. Light is a deliberate choice, not a fallback.
 */
const DEFAULT_THEME: Theme = 'dark';

/**
 * Spec 0.5 puts the interface in pt-PT. A guest whose phone is in English is
 * still a guest, though, so the first guess follows the browser and the toggle
 * in the header overrides it either way.
 */
function detectLocale(): Locale {
  if (typeof navigator === 'undefined') {
    return 'pt-PT';
  }
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language?.toLowerCase().startsWith('pt')) ? 'pt-PT' : 'en';
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      locale: detectLocale(),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'bolsa-settings' },
  ),
);

/**
 * Two surfaces are not the participant's phone and do not follow their choice:
 * the venue screen is a projector in a dark room, and the price table (L2) is
 * a document to print on white paper.
 */
const PINNED_THEMES: Record<string, Theme> = {
  '/screen': 'dark',
  '/prices': 'light',
};

export function themeForPath(path: string, chosen: Theme): Theme {
  return PINNED_THEMES[path] ?? chosen;
}

/** Must match --color-bg in index.css, for the phone's own chrome. */
const BACKGROUNDS: Record<Theme, string> = {
  dark: '#0b0f14',
  light: '#f6f8fb',
};

/**
 * Writes the choices onto <html>, where the CSS custom properties and the
 * accessibility tree can both see them.
 */
export function applySettings(theme: Theme, locale: Locale): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.lang = locale;

  // Installed as a PWA, the status bar is painted by the browser, not by us.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BACKGROUNDS[theme]);
}
