import type { Route } from '../route';
import { Icon } from '../ui/icons';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import type { SidebarLayout } from './layout';
import { NAV_ITEMS, navTooltip } from './nav';

interface Props {
  layout: SidebarLayout;
  route: Route;
  /** Present only where collapsing is possible (≥ 1024px). */
  onToggle?: () => void;
  /** Called after a link is chosen, so a mobile drawer can close itself. */
  onNavigate?: () => void;
}

/**
 * Primary navigation: icon + short label. In `collapsed` mode the labels are
 * hidden visually (never removed, so screen readers still read them) and each
 * item gets a tooltip. The active page is marked with aria-current and a bar.
 */
export function Sidebar({ layout, route, onToggle, onNavigate }: Props) {
  const collapsed = layout === 'collapsed';
  return (
    <nav className="sidebar" data-layout={layout} aria-label="Primary">
      <div className="sb-brand">
        <span className="sb-mark" aria-hidden="true">
          A
        </span>
        <span className="sb-wordmark">AGROSENSE</span>
      </div>

      <ul className="sb-list">
        {NAV_ITEMS.map((n) => {
          const active = n.route === route;
          return (
            <li key={n.route}>
              <Tooltip label={navTooltip(n)} side="right" disabled={!collapsed}>
                <a
                  href={n.href}
                  className={`sb-link ${active ? 'is-active' : ''} ${n.built ? '' : 'is-soon'}`.trim()}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  <Icon name={n.icon} />
                  <span className="sb-label">{n.label}</span>
                  {!n.built && <span className="sb-soon">Soon</span>}
                </a>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      {onToggle && (
        <div className="sb-foot">
          <IconButton
            icon={collapsed ? 'chevron-right' : 'chevron-left'}
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            expanded={!collapsed}
            onClick={onToggle}
            side="right"
          />
        </div>
      )}
    </nav>
  );
}
