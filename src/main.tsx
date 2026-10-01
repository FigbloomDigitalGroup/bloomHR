import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import { antdTheme } from './theme/antdTheme';
import './index.css'


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then((_registration) => {
      console.log('SW registered');
    })
    .catch((error) => {
      console.log('SW registration failed:', error);
    });
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={antdTheme}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
