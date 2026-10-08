import { useEffect, useState } from 'react';

/**
 * Which top-level view to show. The dashboard keeps its hash routes (#/marketplace and so on),
 * so the path only decides between the public pages and the dashboard:
 *   /              → home, unless a dashboard hash (#/…) is present
 *   /login         → sign-in page
 *   /dashboard     → dashboard
 *   anything else  → dashboard (existing hash links and bookmarks keep working)
 */
export type PathView = 'home' | 'login' | 'dashboard';

export function pathView(pathname: string, hash: string): PathView {
  if (pathname === '/login') return 'login';
  if (pathname === '/dashboard') return 'dashboard';
  // In-page anchors (#how, #platform) stay on the home page. Dashboard hashes start with #/.
  if (pathname === '/' && !hash.startsWith('#/')) return 'home';
  return 'dashboard';
}

export function usePathView(): PathView {
  const read = () => pathView(window.location.pathname, window.location.hash);
  const [view, setView] = useState<PathView>(read);
  useEffect(() => {
    const onChange = () => setView(read());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
    // read() only touches window, so it is stable for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return view;
}
