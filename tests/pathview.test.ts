import { describe, expect, it } from 'vitest';
import { pathView } from '../src/pathView';

describe('public path routing', () => {
  it('shows home at the root', () => {
    expect(pathView('/', '')).toBe('home');
    expect(pathView('/', '#')).toBe('home');
  });

  it('keeps the home page for in-page anchors', () => {
    expect(pathView('/', '#how')).toBe('home');
    expect(pathView('/', '#platform')).toBe('home');
  });

  it('shows the sign-in page at /login', () => {
    expect(pathView('/login', '')).toBe('login');
  });

  it('shows the dashboard at /dashboard', () => {
    expect(pathView('/dashboard', '')).toBe('dashboard');
    expect(pathView('/dashboard', '#/marketplace')).toBe('dashboard');
  });

  it('keeps existing dashboard hash links working from the root', () => {
    expect(pathView('/', '#/')).toBe('dashboard');
    expect(pathView('/', '#/alerts')).toBe('dashboard');
    expect(pathView('/', '#/fleet?s=abc')).toBe('dashboard');
  });

  it('sends unknown paths to the dashboard rather than a blank page', () => {
    expect(pathView('/anything', '')).toBe('dashboard');
  });
});
