import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  initialTheme,
  isTheme,
  readSavedTheme,
  resolveTheme,
  saveTheme,
  type ThemeStorage,
} from '../src/theme';

/** A storage whose every call throws, like localStorage in a blocked/private context. */
const blocked: ThemeStorage = {
  getItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem() {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  },
};

function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('theme resolution', () => {
  it('is LIGHT by default, with nothing saved and no dark system preference', () => {
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('follows the system preference only when nothing is saved', () => {
    expect(resolveTheme(null, true)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light'); // a saved choice always wins
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('accepts only the two real theme names', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    for (const bad of ['', 'Dark', 'blue', null, undefined, 1]) expect(isTheme(bad)).toBe(false);
  });
});

describe('saving the choice', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    expect(saveTheme(storage, 'dark')).toBe(true);
    expect(storage.data[THEME_STORAGE_KEY]).toBe('dark');
    expect(readSavedTheme(storage)).toBe('dark');
    saveTheme(storage, 'light');
    expect(readSavedTheme(storage)).toBe('light');
  });

  it('ignores a corrupted saved value instead of trusting it', () => {
    expect(readSavedTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBeNull();
    expect(initialTheme(memoryStorage({ [THEME_STORAGE_KEY]: '{"x":1}' }))).toBe('light');
  });

  it('never throws when storage is blocked: reading yields no preference, writing reports false', () => {
    expect(() => readSavedTheme(blocked)).not.toThrow();
    expect(readSavedTheme(blocked)).toBeNull();
    expect(() => saveTheme(blocked, 'dark')).not.toThrow();
    expect(saveTheme(blocked, 'dark')).toBe(false);
    // …and the app still starts, in the light default.
    expect(initialTheme(blocked)).toBe('light');
  });

  it('copes with no storage at all (access to window.localStorage itself failed)', () => {
    expect(readSavedTheme(null)).toBeNull();
    expect(saveTheme(null, 'dark')).toBe(false);
    expect(initialTheme(null)).toBe('light');
  });

  it('restores a saved dark choice on the next load', () => {
    const storage = memoryStorage();
    saveTheme(storage, 'dark');
    expect(initialTheme(storage)).toBe('dark');
  });
});

describe('applying the theme', () => {
  const fakeRoot = () => {
    const attrs = new Map<string, string>();
    return {
      attrs,
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
      removeAttribute: (n: string) => void attrs.delete(n),
    };
  };

  it('dark sets data-theme="dark"; light removes it so the default needs no attribute', () => {
    const root = fakeRoot();
    applyTheme(root, 'dark');
    expect(root.attrs.get('data-theme')).toBe('dark');
    applyTheme(root, 'light');
    expect(root.attrs.has('data-theme')).toBe(false);
  });
});

describe('Frost & Field stylesheet', () => {
  const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"));
  const darkBlock = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf('* {\n  box-sizing'));

  it('defines the required light tokens on :root', () => {
    const required: Array<[string, RegExp]> = [
      ['--color-primary', /#176b57/i],
      ['--color-accent', /#54c7d9/i],
      ['--color-safe', /#2e9b72/i],
      ['--color-watch', /#d99a2b/i],
      ['--color-critical', /#d94b4b/i],
      ['--color-bg', /#f5f7f2/i],
      ['--color-text', /#17221e/i],
    ];
    for (const [name, value] of required) expect(rootBlock).toMatch(new RegExp(`${name}:\\s*${value.source}`, 'i'));
    for (const name of ['--color-surface', '--color-muted', '--color-border', '--shadow-soft', '--radius-card']) {
      expect(rootBlock).toContain(`${name}:`);
    }
  });

  it('uses an 8px spacing scale, --space-1 … --space-8', () => {
    for (let i = 1; i <= 8; i++) expect(rootBlock).toContain(`--space-${i}: ${i * 8}px;`);
  });

  it('keeps cards within a 12–16px radius', () => {
    const radius = /--radius-card:\s*(\d+)px/.exec(rootBlock);
    expect(Number(radius?.[1])).toBeGreaterThanOrEqual(12);
    expect(Number(radius?.[1])).toBeLessThanOrEqual(16);
  });

  it('defines dark equivalents under [data-theme="dark"] for every core token', () => {
    for (const name of ['--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-border', '--color-primary', '--shadow-soft']) {
      expect(darkBlock).toContain(`${name}:`);
    }
  });

  it('makes the light theme the default: the dark rules are never on bare :root', () => {
    expect(rootBlock).toContain('color-scheme: light');
    expect(darkBlock).toContain('color-scheme: dark');
  });

  it('removed the editorial serif and the old fonts entirely', () => {
    expect(css).not.toMatch(/Fraunces|IBM Plex|Georgia|Iowan/i);
    expect(rootBlock).toMatch(/--font-ui:\s*'Inter'/);
    expect(rootBlock).toMatch(/--font-data:\s*'JetBrains Mono'/);
  });

  it('gives tabular numerals to the shelf-life and price figures', () => {
    expect(css).toMatch(/\.hero-value \{[^}]*font-family: var\(--font-data\)/);
    expect(css).toMatch(/font-variant-numeric: tabular-nums/);
  });

  it('respects reduced motion and shows a strong keyboard focus ring', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/:focus-visible \{[^}]*outline: 3px solid/);
  });

  it('contains no unexpanded template placeholders (a build-breaking bug caught once already)', () => {
    expect(css).not.toContain('$1');
    expect(css).not.toMatch(/\{\s*var\(/);
  });

  it('has no backdrop blur (glassmorphism) and no purple or blue-violet SaaS colours', () => {
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/purple|violet|indigo/i);
  });
});
