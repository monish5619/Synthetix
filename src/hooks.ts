import { useEffect, useRef, useState } from 'react';

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Eases a displayed number toward a target. Starts after `delay` ms, so a number can
 * hold its previous value while a sequence plays. Respects reduced motion.
 *
 * Uses a timer rather than requestAnimationFrame, because animation frames pause in
 * hidden tabs and the number could then freeze at its old value. The final value is
 * always set exactly, so a tween can never end short of the backend's number.
 */
export function useTween(target: number, { duration = 1000, delay = 0 } = {}) {
  const [value, setValue] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    const begin = shown.current;
    if (begin === target) return;
    if (reduceMotion()) {
      shown.current = target;
      setValue(target);
      return;
    }
    let interval = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = () => {
        const p = Math.min(1, (performance.now() - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const next = p >= 1 ? target : begin + (target - begin) * eased;
        shown.current = next;
        setValue(next);
        if (p >= 1) window.clearInterval(interval);
      };
      tick();
      interval = window.setInterval(tick, 16);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      // An interrupted tween lands on its target rather than a half-way value.
      shown.current = target;
      setValue(target);
    };
  }, [target, duration, delay]);

  return value;
}

/** Tracks an element's width in px, so a chart can be drawn at the size it will actually be shown. */
export function useElementWidth<T extends HTMLElement>(fallback = 800) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width) || fallback);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}
