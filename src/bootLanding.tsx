import React from 'react';
import ReactDOM from 'react-dom/client';
import LandingPage from './pages/LandingPage';
import LandingErrorBoundary from './components/Landing/LandingErrorBoundary';

// The public landing page, started by src/main.tsx for a signed-out visit to "/" (src/lib/landingRoute.ts). A bundle of
// its own with no app in it: no sign-in, no database client, no router. Its links are plain addresses, so each one opens
// the app fresh. The visitor's saved theme is deliberately not applied: the page is designed on the default palette, and
// a dark page colour left behind by Settings > Appearance would remap its backgrounds and text.
export default function bootLanding(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LandingErrorBoundary>
        <LandingPage />
      </LandingErrorBoundary>
    </React.StrictMode>
  );
}
