import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { forgetAccountOnSignInOut } from './lib/accountCache';
import App from './App';
import ConfigError from './components/Setup/ConfigError';
import { missingConfig } from './lib/requiredConfig';
import { BrowserRouter } from 'react-router-dom';
import ThemedConfigProvider from './theme/ThemedConfigProvider';
import './index.css'
import { applyStoredTheme } from './theme/applyTheme';
import { reloadOnceForStaleChunk } from './lib/staleChunk';
import { applyA11y, loadA11y } from './lib/a11y';
import A11yMotion from './components/Accessibility/A11yMotion';


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then((_registration) => {
      console.log('SW registered');
    })
    .catch((error) => {
      console.log('SW registration failed:', error);
    });
}
// Vite fires this when a page file it needs is gone (a new version was deployed): load the new version once
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadOnceForStaleChunk();
});

applyA11y(loadA11y()); // text size, bolder text, contrast: also before the first render
applyStoredTheme(); // before the first render, so the page never flashes the default colours
forgetAccountOnSignInOut(queryClient); // a new sign-in never sees the last one's permissions or companies
const missing = missingConfig(import.meta.env);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {missing.length > 0 ? (
      <ConfigError missing={missing} />
    ) : (
      <QueryClientProvider client={queryClient}>
        <ThemedConfigProvider>
          <BrowserRouter>
            <A11yMotion>
              <App />
            </A11yMotion>
          </BrowserRouter>
        </ThemedConfigProvider>
      </QueryClientProvider>
    )}
  </React.StrictMode>
);
