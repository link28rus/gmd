'use client';

/**
 * Сегментный переключатель темы (Sun / Cloud / Moon) —
 * ставится в правом верхнем углу /cabinet и /admin
 * через `fixed right-4 top-4 z-40 lg:right-6 lg:top-6` в соответствующих layouts.
 *
 * Требует <ThemeProvider> выше по дереву.
 */

import { Sun, Cloud, Moon, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { useTheme, type GmdTheme } from './theme-provider';

type Option = {
  value: GmdTheme;
  label: string;
  icon: LucideIcon;
};

const options: Option[] = [
  { value: 'light', label: 'Светлая', icon: Sun },
  { value: 'dim', label: 'Средняя', icon: Cloud },
  { value: 'dark', label: 'Тёмная', icon: Moon },
];

export function ThemeSwitcher(): ReactElement {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Тема оформления"
      className="flex items-center gap-1 rounded-lg border border-border/50 bg-card/80 p-1 backdrop-blur-sm supports-[backdrop-filter]:bg-card/60"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              active
                ? 'bg-card text-primary shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
