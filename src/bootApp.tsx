import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { forgetAccountOnSignInOut } from './lib/accountCache';
import { refreshPermissionsOnRoleChange } from './lib/livePermissions';
import { forgetFormDraftsOnSignOut } from './lib/formDraft';
import App from './App';
import ConfigError from './components/Setup/ConfigError';
import { missingConfig } from './lib/requiredConfig';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ThemedConfigProvider from './theme/ThemedConfigProvider';
import { applyStoredTheme } from './theme/applyTheme';
import A11yMotion from './components/Accessibility/A11yMotion';
import DialogHost from './components/UI/DialogHost';

// The app itself: sign-in, the company pages and every screen. src/main.tsx loads this file only when the address is
// not the public landing page (src/lib/landingRoute.ts), so landing visitors never download it. Everything below used
// to run when main.tsx loaded, in the same order.

// A company's public careers page (FIG-838) stands alone: no sign-in, none of the app around it, and it may be
// framed on the company's own website.
const CareersPage = lazy(() => import('./pages/CareersPage'));
// The check behind a staff ID card's QR code (/verify/<token>, migration 20261027400000) stands alone the same way:
// whoever scans a card is not signed in to the company's app.
const VerifyStaffIdPage = lazy(() => import('./pages/VerifyStaffIdPage'));

export default function bootApp(): void {
  applyStoredTheme(); // before the first render, so the page never flashes the default colours
  forgetAccountOnSignInOut(queryClient); // a new sign-in never sees the last one's permissions or companies
  refreshPermissionsOnRoleChange(queryClient); // a role changed by an admin shows without a refresh
  forgetFormDraftsOnSignOut(); // unsaved personal details typed in this tab go with the person who typed them
  const missing = missingConfig(import.meta.env);
  const isCareersPage = /^\/careers\/[^/]+/.test(window.location.pathname);
  const isVerifyPage = /^\/verify\/[^/]+/.test(window.location.pathname);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    isCareersPage || isVerifyPage ? (
      <React.StrictMode>
        <BrowserRouter>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/careers/:slug" element={<CareersPage />} />
              <Route path="/careers/:slug/jobs/:jobId" element={<CareersPage />} />
              <Route path="/verify/:token" element={<VerifyStaffIdPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </React.StrictMode>
    ) : (
      <React.StrictMode>
        {missing.length > 0 ? (
          <ConfigError missing={missing} />
        ) : (
          <QueryClientProvider client={queryClient}>
            <ThemedConfigProvider>
              <BrowserRouter>
                <A11yMotion>
                  <App />
                  <DialogHost />
                </A11yMotion>
              </BrowserRouter>
            </ThemedConfigProvider>
          </QueryClientProvider>
        )}
      </React.StrictMode>
    )
  );
}
