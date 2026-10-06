import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import App from './App';
import ConfigError from './components/Setup/ConfigError';
import { missingConfig } from './lib/requiredConfig';
import { BrowserRouter } from 'react-router-dom';
import { antdTheme } from './theme/antdTheme';
import './index.css'
import { applyStoredTheme } from './theme/applyTheme';


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then((_registration) => {
      console.log('SW registered');
    })
    .catch((error) => {
      console.log('SW registration failed:', error);
    });
}
applyStoredTheme(); // before the first render, so the page never flashes the default colours
const missing = missingConfig(import.meta.env);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {missing.length > 0 ? (
      <ConfigError missing={missing} />
    ) : (
      <QueryClientProvider client={queryClient}>
        <ConfigProvider theme={antdTheme}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfigProvider>
      </QueryClientProvider>
    )}
  </React.StrictMode>
);
