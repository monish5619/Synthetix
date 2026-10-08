import type { MouseEventHandler } from 'react';
import { Icon, type GlyphName } from './icons';
import { Tooltip } from './Tooltip';

interface Props {
  icon: GlyphName;
  /** The accessible name, also the tooltip. Icon-only controls must always have one. */
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** For toggles: exposes the on/off state. */
  pressed?: boolean;
  /** For menus and drawers this button opens. */
  expanded?: boolean;
  controls?: string;
  /**
   * A placeholder for something that does not exist yet. The button stays
   * focusable (so the tooltip is reachable by keyboard) but does nothing, and
   * the tooltip says why.
   */
  unavailable?: string;
  side?: 'right' | 'bottom' | 'bottom-end' | 'top';
  className?: string;
}

/** A compact icon-only button: name, tooltip and state in one place. */
export function IconButton({ icon, label, onClick, pressed, expanded, controls, unavailable, side = 'bottom-end', className = '' }: Props) {
  const tip = unavailable ? `${label} — ${unavailable}` : label;
  return (
    <Tooltip label={tip} side={side}>
      <button
        type="button"
        className={`icon-btn ${className}`.trim()}
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-disabled={unavailable ? true : undefined}
        onClick={unavailable ? undefined : onClick}
      >
        <Icon name={icon} />
      </button>
    </Tooltip>
  );
}
