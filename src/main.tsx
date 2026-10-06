import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import App from './App';
import ConfigError from './components/Setup/ConfigError';
import { missingConfig } from './lib/requiredConfig';
import { BrowserRouter } from 'react-router-dom';
import ThemedConfigProvider from './theme/ThemedConfigProvider';
import './index.css'
import { applyStoredTheme } from './theme/applyTheme';
import { reloadOnceForStaleChunk } from './lib/staleChunk';


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

applyStoredTheme(); // before the first render, so the page never flashes the default colours
const missing = missingConfig(import.meta.env);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {missing.length > 0 ? (
      <ConfigError missing={missing} />
    ) : (
      <QueryClientProvider client={queryClient}>
        <ThemedConfigProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemedConfigProvider>
      </QueryClientProvider>
    )}
  </React.StrictMode>
);
