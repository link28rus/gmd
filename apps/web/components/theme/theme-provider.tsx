'use client';

/**
 * Темизация web-кабинета и админки Перископ.
 *
 * Три темы: `light` | `dim` (средняя, приглушённая) | `dark`.
 * Применяется ТОЛЬКО в /cabinet и /admin — публичный лендинг
 * (`/`, `/login`, `/privacy`, ...) остаётся без темы (не ставим атрибут,
 * body использует свой background из globals.css).
 *
 * Storage: `localStorage['gmd-theme']`.
 * Атрибут на `<html>`: `data-admin-theme="light|dim|dark"`.
 * Для совместимости с компонентами shadcn/Tailwind, использующими `dark:`
 * варианты — ставим класс `.dark` на `<html>` для темы `dark`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export type GmdTheme = 'light' | 'dim' | 'dark';

const STORAGE_KEY = 'gmd-theme';
const ATTRIBUTE = 'data-admin-theme';
const DEFAULT_THEME: GmdTheme = 'light';

const isGmdTheme = (value: string | null): value is GmdTheme =>
  value === 'light' || value === 'dim' || value === 'dark';

function readStoredTheme(): GmdTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isGmdTheme(stored) ? stored : DEFAULT_THEME;
}

type ThemeContextValue = {
  theme: GmdTheme;
  setTheme: (next: GmdTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [theme, setThemeState] = useState<GmdTheme>(DEFAULT_THEME);

  // Первичная подгрузка из localStorage после монтирования — избегаем
  // SSR/CSR рассинхрона (сервер всегда отдаёт light).
  useEffect(() => {
    setThemeState(readStoredTheme());
  }, []);

  // Синхронизация с DOM. На unmount снимаем атрибут/класс,
  // чтобы при выходе в публичный layout страница не оставалась «tinted».
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(ATTRIBUTE, theme);
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    return () => {
      root.removeAttribute(ATTRIBUTE);
      root.classList.remove('dark');
    };
  }, [theme]);

  const setTheme = useCallback((next: GmdTheme) => {
    setThemeState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
