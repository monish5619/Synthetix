import { useState } from 'react';
import { applyTheme, browserStorage, initialTheme, saveTheme, type Theme } from '../theme';
import { IconButton } from '../ui/IconButton';

/**
 * Switches between Frost & Field light (default) and the dark Control Room.
 * Compact icon button: a stable name, its on/off state exposed with aria-pressed,
 * and a tooltip. The icon shows the theme you are in.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
  const dark = theme === 'dark';

  const toggle = () => {
    const next: Theme = dark ? 'light' : 'dark';
    setTheme(next);
    applyTheme(document.documentElement, next);
    saveTheme(browserStorage(), next); // ignored safely if storage is blocked
  };

  return (
    <IconButton
      icon={dark ? 'moon' : 'sun'}
      label="Control Room (dark) theme"
      pressed={dark}
      onClick={toggle}
      className="theme-toggle"
    />
  );
}
