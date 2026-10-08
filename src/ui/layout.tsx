import type { ReactNode } from 'react';
import { Icon, type GlyphName } from './icons';

/* Small presentational building blocks. They hold no data and no logic. */

export type Tone = 'neutral' | 'safe' | 'watch' | 'critical' | 'accent';

/** A short label chip. Say what it is in a word or two. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

/** The standard surface: soft shadow, 14px radius. Content only; no explanatory paragraphs. */
export function Card({ title, actions, children, as: Tag = 'section' }: { title?: string; actions?: ReactNode; children: ReactNode; as?: 'section' | 'div' | 'article' }) {
  return (
    <Tag className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </Tag>
  );
}

/** Page title and at most one short subtitle. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1 id="page-title" className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Nothing to show yet: a title, one short line, and an optional next step. */
export function EmptyState({ icon = 'inbox', title, hint, action }: { icon?: GlyphName; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
      {action}
    </div>
  );
}

/** Something failed: what happened, and a way to try again. Announced to screen readers immediately. */
export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <span className="empty-icon error-icon">
        <Icon name="warning" size={26} />
      </span>
      <p className="empty-title">{title}</p>
      <p className="empty-hint">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** A loading placeholder block. Pass the size, not a spinner. */
export function Skeleton({ height = 16, width = '100%' }: { height?: number | string; width?: number | string }) {
  return <div className="sk" style={{ height, width }} aria-hidden="true" />;
}
