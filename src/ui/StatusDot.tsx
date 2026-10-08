import { DOT_WORD, type DotState } from '../shell/status';
import { Tooltip } from './Tooltip';

interface Props {
  state: DotState;
  /** The exact meaning, shown in the tooltip and read by screen readers. */
  meaning: string;
  side?: 'right' | 'bottom' | 'bottom-end' | 'top';
}

/**
 * A compact status indicator: green = healthy, amber = warning, red = failure.
 * Colour is never the only signal — each state also has its own shape
 * (circle, diamond, square) — and the exact meaning is one hover or focus away.
 */
export function StatusDot({ state, meaning, side = 'top' }: Props) {
  return (
    <Tooltip label={meaning} side={side}>
      <span className="status-dot" data-state={state} role="img" aria-label={`${DOT_WORD[state]}: ${meaning}`} tabIndex={0} />
    </Tooltip>
  );
}
