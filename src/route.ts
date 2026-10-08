import { useEffect, useState } from 'react';

/**
 * Every page the navigation knows about. The first four have always existed.
 * The rest are reserved so the shell and its links are stable now; their pages
 * say plainly that they are not built yet (see shell/nav.ts → `built`).
 */
export const ROUTES = [
  'control',
  'fleet',
  'marketplace',
  'telemetry',
  'alerts',
  'impact',
  'explainability',
  'admin',
  'status',
] as const;
export type Route = (typeof ROUTES)[number];

const readRoute = (): Route => {
  const name = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'control';
};

/** Hash-based routing: no router dependency, and each page is addressable. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const ROUTE_HREF: Record<Route, string> = {
  control: '#/',
  fleet: '#/fleet',
  marketplace: '#/marketplace',
  telemetry: '#/telemetry',
  alerts: '#/alerts',
  impact: '#/impact',
  explainability: '#/explainability',
  admin: '#/admin',
  status: '#/status',
};
