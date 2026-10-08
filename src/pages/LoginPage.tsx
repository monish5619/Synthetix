import { useState, type FormEvent } from 'react';
import { BrandMark } from '../components/BrandMark';

/**
 * Sign-in page. AgroSense has no user accounts yet, so this form does not check anything.
 * Submitting says so plainly and offers the demo control tower. It never pretends a login happened.
 */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className="login">
      <aside className="login-brand" aria-hidden={false}>
        <a className="home-brand" href="/">
          <BrandMark size={36} />
          <span className="home-wordmark">AGROSENSE</span>
        </a>
        <div className="login-copy">
          <p className="eyebrow">Intelligent Cold-Chain Control Tower</p>
          <h1 className="login-title">Predict shelf life. Sell before it spoils.</h1>
          <p className="login-lede">Temperature, humidity and transit, turned into remaining shelf life and a commercial decision.</p>
        </div>
        <TemperatureLine />
      </aside>

      <main className="login-panel" id="main">
        <div className="login-card">
          <h2 className="login-welcome">Welcome back</h2>
          <p className="login-sub">Sign in to your control tower.</p>

          <form className="login-form" onSubmit={onSubmit} noValidate>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                className="field-input"
                type="email"
                name="email"
                autoComplete="username"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                className="field-input"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            <div className="login-row">
              <span className="login-disabled" aria-disabled="true" title="Not available in this build">
                Forgot password?
              </span>
            </div>

            <button type="submit" className="btn btn-primary btn-lg login-submit">
              Sign in
            </button>
          </form>

          {submitted && (
            <div className="login-notice" role="status">
              <p>
                <strong>Sign-in isn't enabled in this build.</strong> AgroSense has no user accounts yet, so nothing was checked.
              </p>
              <a className="btn btn-secondary" href="/dashboard">
                Continue to the demo control tower
              </a>
            </div>
          )}

          <p className="login-foot">
            Don't have an account? <span className="login-disabled" aria-disabled="true" title="Not available in this build">Create one</span>
          </p>
        </div>
      </main>
    </div>
  );
}

/** A decorative temperature trace with its safe band and a threshold. Static; no motion. */
function TemperatureLine() {
  return (
    <svg className="login-line" viewBox="0 0 420 120" aria-hidden="true" focusable="false">
      <rect x="0" y="34" width="420" height="36" fill="#eef4fb" />
      <line x1="0" y1="34" x2="420" y2="34" stroke="#c9d6e6" strokeDasharray="4 5" />
      <line x1="0" y1="92" x2="420" y2="92" stroke="#d94b4b" strokeDasharray="4 5" opacity="0.7" />
      <path d="M8 52 L60 52 L84 46 L110 56 L150 52 L178 40 L206 28 L232 22 L262 34 L300 74 L340 84 L412 88" fill="none" stroke="#3b6fb6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="232" cy="22" r="4" fill="#d99a2b" />
    </svg>
  );
}
