/**
 * A small decorative illustration of a refrigerated produce crate: tomatoes, a sensor
 * probe, and a snowflake. Pure SVG, no image asset. It is decorative, so it is hidden
 * from assistive technology, and its gentle float is switched off for reduced motion.
 */
export function FloatingCrate() {
  return (
    <svg className="float-crate" viewBox="0 0 160 130" aria-hidden="true" focusable="false">
      {/* soft ground shadow */}
      <ellipse cx="80" cy="120" rx="54" ry="5" fill="#17221e" opacity="0.08" />
      {/* crate, isometric front and top */}
      <path d="M26 62 L80 40 L134 62 L80 84 Z" fill="#e6f3ec" stroke="#2e9b72" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M26 62 L80 84 L80 116 L26 94 Z" fill="#ffffff" stroke="#2e9b72" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M80 84 L134 62 L134 94 L80 116 Z" fill="#eef4ef" stroke="#2e9b72" strokeWidth="1.5" strokeLinejoin="round" />
      {/* slats */}
      <path d="M36 74 L70 90 M36 84 L70 100 M90 90 L124 74 M90 100 L124 84" stroke="#b9d9c8" strokeWidth="1.2" fill="none" />
      {/* tomatoes resting in the crate */}
      <circle cx="58" cy="60" r="9" fill="#e0573c" />
      <circle cx="78" cy="54" r="9" fill="#d94b4b" />
      <circle cx="100" cy="60" r="9" fill="#e0573c" />
      <path d="M58 52 q3 -5 7 -3 q-4 1 -7 3z M78 46 q3 -5 7 -3 q-4 1 -7 3z M100 52 q3 -5 7 -3 q-4 1 -7 3z" fill="#2e9b72" />
      {/* leaf */}
      <path d="M118 48 q10 -12 22 -6 q-8 12 -22 6z" fill="#69d3ae" />
      {/* temperature probe */}
      <rect x="14" y="26" width="8" height="30" rx="4" fill="#ffffff" stroke="#60716a" strokeWidth="1.2" />
      <circle cx="18" cy="60" r="5" fill="#54c7d9" />
      <rect x="16" y="36" width="4" height="18" rx="2" fill="#54c7d9" />
      {/* snowflake */}
      <g stroke="#54c7d9" strokeWidth="2" strokeLinecap="round">
        <path d="M140 18 v16 M132 26 h16 M134 20 l12 12 M146 20 l-12 12" />
      </g>
    </svg>
  );
}
