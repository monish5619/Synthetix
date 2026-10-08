import { ROUTE_HREF, type Route } from '../route';

export type IconName =
  | 'tower'
  | 'fleet'
  | 'market'
  | 'telemetry'
  | 'alerts'
  | 'impact'
  | 'explain'
  | 'admin'
  | 'status';

export interface NavItem {
  route: Route;
  /** Short label: one or two words. */
  label: string;
  icon: IconName;
  href: string;
  /**
   * True only when the page does real work today. Everything else is shown
   * with a "Soon" tag and opens an honest placeholder — never fake content.
   */
  built: boolean;
}

const item = (route: Route, label: string, icon: IconName, built: boolean): NavItem => ({
  route,
  label,
  icon,
  href: ROUTE_HREF[route],
  built,
});

/** In display order. */
export const NAV_ITEMS: readonly NavItem[] = [
  item('control', 'Control Tower', 'tower', true),
  item('fleet', 'Fleet', 'fleet', true),
  item('marketplace', 'Marketplace', 'market', true),
  item('telemetry', 'Telemetry', 'telemetry', true),
  item('alerts', 'Alerts', 'alerts', true),
  item('impact', 'Impact', 'impact', false),
  item('explainability', 'Explainability', 'explain', false),
  item('admin', 'Admin', 'admin', false),
  item('status', 'Status', 'status', true),
];

export const navItemFor = (route: Route): NavItem => {
  const found = NAV_ITEMS.find((n) => n.route === route);
  if (!found) throw new Error(`No navigation item for route "${route}"`);
  return found;
};

/** The tooltip for a nav item: its name, plus "not built yet" when that is the truth. */
export const navTooltip = (n: NavItem) => (n.built ? n.label : `${n.label} — not built yet`);
