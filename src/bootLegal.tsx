import React from 'react';
import ReactDOM from 'react-dom/client';
import LegalPage from './pages/LegalPage';
import LandingErrorBoundary from './components/Landing/LandingErrorBoundary';

// The Privacy Policy and Terms, started by src/main.tsx once they are approved (src/lib/legalGate.ts). Same idea as the
// landing page: a small bundle of its own, no app, no saved theme.
export default function bootLegal(): void {
  const kind = window.location.pathname.replace(/\/+$/, '') === '/terms' ? 'terms' : 'privacy';
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LandingErrorBoundary>
        <LegalPage kind={kind} />
      </LandingErrorBoundary>
    </React.StrictMode>
  );
}
