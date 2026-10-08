import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, initialTheme } from './theme';
import './styles.css';

// Choose the theme before the first render so there is no flash of the wrong one.
// Light is the default; a saved choice wins; the system preference applies only when nothing is saved.
applyTheme(document.documentElement, initialTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
