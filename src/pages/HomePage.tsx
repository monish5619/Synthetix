import { BrandMark } from '../components/BrandMark';
import { HeroVisual } from '../components/HeroVisual';

const DASHBOARD = '/dashboard';

const STORY = [
  { n: '01', title: 'Monitor', body: 'Temperature and humidity telemetry' },
  { n: '02', title: 'Predict', body: 'Remaining shelf life' },
  { n: '03', title: 'Assess', body: 'Spoilage risk' },
  { n: '04', title: 'Act', body: 'Dynamic liquidation recommendation' },
  { n: '05', title: 'Notify', body: 'Retail marketplace and alerts' },
];

const SCENARIO = [
  { label: 'Normal shipment', value: '5 days remaining', tone: 'calm' },
  { label: 'Ambient temperature spike', value: 'Temperature and humidity rise', tone: 'warn' },
  { label: 'Degradation detected', value: 'Ageing accelerates', tone: 'warn' },
  { label: 'Shelf life collapses', value: '≈18 hours remaining', tone: 'critical' },
  { label: 'Markdown recommended', value: 'Price reduced before spoilage', tone: 'action' },
  { label: 'Retailer alert raised', value: 'Listing and alert raised', tone: 'action' },
];

const CAPABILITIES = [
  { title: 'Cold-chain telemetry', body: 'Monitor temperature, humidity and transit conditions.' },
  { title: 'Shelf-life intelligence', body: 'Translate environmental exposure into remaining shelf life.' },
  { title: 'Spoilage risk', body: 'Identify when inventory is approaching a critical state.' },
  { title: 'Dynamic liquidation', body: 'Recommend markdown actions before produce becomes unsellable.' },
  { title: 'Marketplace response', body: 'Turn operational intelligence into a commercial action.' },
];

export function HomePage() {
  return (
    <div className="home">
      <header className="home-nav">
        <a className="home-brand" href="/">
          <BrandMark />
          <span className="home-wordmark">AGROSENSE</span>
        </a>
        <nav className="home-links" aria-label="Site">
          <a href="#platform">Platform</a>
          <a href="#how">How It Works</a>
          <a href={DASHBOARD}>Control Tower</a>
        </nav>
        <div className="home-actions">
          <a className="home-signin" href="/login">
            Sign In
          </a>
          <a className="btn btn-primary btn-sm" href={DASHBOARD}>
            Open Control Tower
          </a>
        </div>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="eyebrow">AgroSense · Perishable cold-chain intelligence</p>
          <h1 id="home-title" className="home-title">
            Know the shelf life.
            <br />
            Act before the spoilage.
          </h1>
          <p className="home-lede">
            AgroSense continuously interprets cold-chain conditions to predict remaining shelf life, identify spoilage risk,
            and trigger timely liquidation decisions.
          </p>
          <div className="home-cta">
            <a className="btn btn-primary btn-lg" href={DASHBOARD}>
              Open Control Tower
            </a>
            <a className="btn btn-secondary btn-lg" href="#how">
              Explore how it works
            </a>
          </div>
          <p className="home-tagline">Intelligent Cold-Chain Control Tower · Protect perishables before they become waste.</p>
        </div>
        <HeroVisual />
      </section>

      <section className="home-section" id="how" aria-labelledby="how-title">
        <p className="eyebrow">How it works</p>
        <h2 id="how-title" className="home-h2">
          From temperature spike to commercial action.
        </h2>
        <ol className="home-flow">
          {STORY.map((s, i) => (
            <li key={s.n} className="home-flow-step">
              <span className="home-flow-n">{s.n}</span>
              <span className="home-flow-title">{s.title}</span>
              <span className="home-flow-body">{s.body}</span>
              {i < STORY.length - 1 && <span className="home-flow-arrow" aria-hidden="true">→</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section home-scenario" aria-labelledby="scenario-title">
        <p className="eyebrow">The PS-08 scenario</p>
        <h2 id="scenario-title" className="home-h2">
          When conditions change, the decision changes.
        </h2>
        <p className="home-note">
          The sequence the dashboard runs. The figures are the demo's known results; the dashboard reads the live values from
          its database.
        </p>
        <ol className="scenario">
          {SCENARIO.map((s) => (
            <li key={s.label} className={`scenario-step tone-${s.tone}`}>
              <span className="scenario-dot" aria-hidden="true" />
              <span className="scenario-label">{s.label}</span>
              <span className="scenario-value">{s.value}</span>
            </li>
          ))}
        </ol>
        <a className="btn btn-primary btn-lg" href={DASHBOARD}>
          Run the scenario in the Control Tower
        </a>
      </section>

      <section className="home-section" id="platform" aria-labelledby="platform-title">
        <p className="eyebrow">Platform</p>
        <h2 id="platform-title" className="home-h2">
          Five capabilities, one decision.
        </h2>
        <ul className="capabilities">
          {CAPABILITIES.map((c) => (
            <li key={c.title} className="capability">
              <h3 className="capability-title">{c.title}</h3>
              <p className="capability-body">{c.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="home-footer">
        <span>AgroSense · Synthetix · PS-08 · AgriTech &amp; Perishable Cold Chain</span>
      </footer>
    </div>
  );
}
