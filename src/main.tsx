import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { forgetAccountOnSignInOut } from './lib/accountCache';
import App from './App';
import ConfigError from './components/Setup/ConfigError';
import { missingConfig } from './lib/requiredConfig';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ThemedConfigProvider from './theme/ThemedConfigProvider';
import './index.css'
import { applyStoredTheme } from './theme/applyTheme';
import { reloadOnceForStaleChunk } from './lib/staleChunk';
import { applyA11y, loadA11y } from './lib/a11y';
import A11yMotion from './components/Accessibility/A11yMotion';
import DialogHost from './components/UI/DialogHost';


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then((_registration) => {
      console.log('SW registered');
    })
    .catch((error) => {
      console.log('SW registration failed:', error);
    });
}
// Vite fires this when a page file it needs is gone (a new version was deployed): load the new version once.
// Only cancel the error when the page is really reloading: a cancelled error makes the page import "succeed" with
// nothing, and React then fails with "Cannot read properties of undefined (reading 'default')", which nothing
// recognises. Left alone, the error reaches the error screen as "Failed to fetch dynamically imported module".
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForStaleChunk()) event.preventDefault();
});

applyA11y(loadA11y()); // text size, bolder text, contrast: also before the first render
applyStoredTheme(); // before the first render, so the page never flashes the default colours
forgetAccountOnSignInOut(queryClient); // a new sign-in never sees the last one's permissions or companies
const missing = missingConfig(import.meta.env);
// A company's public careers page (FIG-838) stands alone: no sign-in, none of the app around it, and it may be
// framed on the company's own website.
const CareersPage = lazy(() => import('./pages/CareersPage'));
const isCareersPage = /^\/careers\/[^/]+/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  isCareersPage ? (
    <React.StrictMode>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/careers/:slug" element={<CareersPage />} />
            <Route path="/careers/:slug/jobs/:jobId" element={<CareersPage />} />
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
