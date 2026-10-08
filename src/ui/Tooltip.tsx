import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

interface Props {
  /** The words shown. Keep them short. */
  label: string;
  /** Where the bubble sits relative to the trigger. */
  side?: 'right' | 'bottom' | 'bottom-end' | 'top';
  /** Skip the bubble entirely (e.g. when the control's own text is already visible). */
  disabled?: boolean;
  /** One focusable element. It is linked to the bubble with aria-describedby. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

const EDGE = 8;

/**
 * A tooltip that works for keyboard and screen-reader users, not only the mouse:
 * it opens on hover AND on keyboard focus, closes with Escape, and is linked to
 * its trigger with aria-describedby. It never holds information that is not
 * available some other way — it explains, it does not gate.
 *
 * It takes no space while closed (so it can never widen the page), and when it
 * opens it nudges itself back inside the viewport, so a tooltip on a control near
 * the screen edge on a phone is never cut off.
 */
export function Tooltip({ label, side = 'bottom', disabled = false, children }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const bubble = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Measure after it is displayed but before it is painted, then shift it inside the viewport.
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!open || !el) return;
    el.style.setProperty('--tip-shift', '0px');
    const rect = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let shift = 0;
    if (rect.left < EDGE) shift = EDGE - rect.left;
    else if (rect.right > vw - EDGE) shift = vw - EDGE - rect.right;
    el.style.setProperty('--tip-shift', `${Math.round(shift)}px`);
  }, [open, label]);

  if (disabled) return children;

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  return (
    <span className="tip" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span ref={bubble} id={id} role="tooltip" className={`tip-bubble tip-${side}`} data-open={open || undefined}>
        {label}
      </span>
    </span>
  );
}
