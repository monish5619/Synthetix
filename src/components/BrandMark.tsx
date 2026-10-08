/**
 * The AgroSense mark: a rounded square with a temperature trace that crosses a threshold,
 * and a signal arc. It reads as cold-chain monitoring, not as agriculture.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="brand-mark">
      <rect x="0" y="0" width="32" height="32" rx="9" fill="#1d2c4a" />
      <path d="M6 20 L11 20 L14 13 L18 22 L21 17 L26 17" fill="none" stroke="#8fc3ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11 Q16 4 24 11" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
