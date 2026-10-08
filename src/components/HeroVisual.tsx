/**
 * The home-page hero: a refrigerated container drawn as layered SVG planes with simple
 * lighting, with live-looking telemetry around it. The project has no 3D library, so this
 * is a CSS/SVG composition, which keeps it light and fast. It is decorative, so it is hidden
 * from assistive technology. Motion is subtle and is switched off by prefers-reduced-motion.
 */
export function HeroVisual() {
  return (
    <div className="hero-visual" aria-hidden="true">
      <svg viewBox="0 0 520 420" className="hv-svg" focusable="false">
        <defs>
          <linearGradient id="hv-side" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e9edf3" />
            <stop offset="1" stopColor="#b9c3d0" />
          </linearGradient>
          <linearGradient id="hv-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#dfe5ed" />
          </linearGradient>
          <linearGradient id="hv-top" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#f6f8fb" />
            <stop offset="1" stopColor="#cfd8e3" />
          </linearGradient>
          <linearGradient id="hv-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1f3556" />
            <stop offset="1" stopColor="#0f1d33" />
          </linearGradient>
          <radialGradient id="hv-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#3b6fb6" stopOpacity="0.18" />
            <stop offset="1" stopColor="#3b6fb6" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="260" cy="356" rx="200" ry="22" fill="url(#hv-glow)" />
        <ellipse cx="260" cy="352" rx="176" ry="14" fill="#17221e" opacity="0.10" />

        <g className="hv-container">
          {/* container body: front, side and roof planes */}
          <path d="M92 150 L300 110 L300 300 L92 340 Z" fill="url(#hv-front)" stroke="#9aa7b8" strokeWidth="1.2" />
          <path d="M300 110 L428 150 L428 340 L300 300 Z" fill="url(#hv-side)" stroke="#9aa7b8" strokeWidth="1.2" />
          <path d="M92 150 L220 96 L348 96 L300 110 Z" fill="url(#hv-top)" stroke="#9aa7b8" strokeWidth="1.2" />
          <path d="M300 110 L348 96 L428 150 Z" fill="#dfe6ee" stroke="#9aa7b8" strokeWidth="1" />

          {/* ribbing on the side */}
          <path d="M320 128 L320 318 M344 137 L344 327 M368 146 L368 336 M392 155 L392 345 M412 162 L412 352" stroke="#9aa7b8" strokeWidth="1" opacity="0.6" />

          {/* open door showing produce inside */}
          <path d="M120 170 L270 140 L270 290 L120 320 Z" fill="url(#hv-glass)" />
          <path d="M120 170 L270 140 L270 150 L120 180 Z" fill="#0b1626" opacity="0.4" />
          <circle cx="158" cy="232" r="13" fill="#e0573c" />
          <circle cx="196" cy="222" r="13" fill="#d94b4b" />
          <circle cx="234" cy="236" r="13" fill="#e0573c" />
          <circle cx="176" cy="268" r="12" fill="#c8402f" />
          <circle cx="216" cy="268" r="12" fill="#e0573c" />
          <path d="M150 218 q4 -8 11 -5 q-6 2 -11 5z M188 208 q4 -8 11 -5 q-6 2 -11 5z M226 222 q4 -8 11 -5 q-6 2 -11 5z" fill="#2e9b72" />

          {/* temperature probe on the door */}
          <rect x="268" y="176" width="8" height="46" rx="4" fill="#ffffff" stroke="#60716a" strokeWidth="1" transform="skewY(-8)" />
          <circle cx="272" cy="230" r="5" fill="#3b6fb6" transform="skewY(-8)" />

          {/* amber warning lamp */}
          <circle cx="380" cy="128" r="6" fill="#d99a2b" className="hv-lamp" />
        </g>

        {/* telemetry waveform, drawn over the container */}
        <g className="hv-wave" transform="translate(40 36)">
          <rect x="0" y="0" width="200" height="66" rx="10" fill="#ffffff" stroke="#d6dde7" />
          <path d="M14 46 L40 46 L52 36 L66 46 L92 46 L104 22 L120 46 L146 46 L158 30 L176 46 L186 46" fill="none" stroke="#3b6fb6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="hv-trace" />
          <text x="14" y="18" className="hv-label">TEMP · 30.0°C</text>
        </g>

        {/* humidity and shelf-life indicators */}
        <g transform="translate(372 210)">
          <rect x="0" y="0" width="118" height="70" rx="10" fill="#ffffff" stroke="#d6dde7" />
          <text x="12" y="20" className="hv-label">HUMIDITY</text>
          <rect x="12" y="30" width="94" height="8" rx="4" fill="#e6ebf2" />
          <rect x="12" y="30" width="80" height="8" rx="4" fill="#3b6fb6" />
          <text x="12" y="56" className="hv-value">85% RH</text>
        </g>

        {/* route with a moving truck */}
        <path d="M70 392 C170 372, 350 412, 462 380" fill="none" stroke="#9aa7b8" strokeWidth="2" strokeDasharray="5 6" />
        <circle cx="70" cy="392" r="5" fill="#1d2c4a" />
        <circle cx="462" cy="380" r="5" fill="#d99a2b" />
        <g className="hv-truck">
          <rect x="0" y="0" width="30" height="16" rx="3" fill="#1d2c4a" />
          <rect x="30" y="4" width="10" height="12" rx="2" fill="#3b6fb6" />
          <circle cx="8" cy="18" r="3" fill="#17221e" />
          <circle cx="32" cy="18" r="3" fill="#17221e" />
        </g>
      </svg>
    </div>
  );
}
