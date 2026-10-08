import { useTween } from '../hooks';

/**
 * A number that counts to its value instead of jumping. It always lands exactly
 * on the value it was given, and with reduced motion it simply shows it.
 */
export function CountUp({ value, decimals = 0, delay = 0, duration = 900, format }: { value: number; decimals?: number; delay?: number; duration?: number; format?: (n: number) => string }) {
  const shown = useTween(value, { duration, delay });
  return <>{format ? format(shown) : shown.toFixed(decimals)}</>;
}
