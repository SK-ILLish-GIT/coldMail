import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';

import App from './App.jsx';
import './index.css';

// Sync the theme class on <html> BEFORE React mounts. This avoids the
// double-render flash and also prevents HMR/fast-refresh from leaving the
// `dark` class stuck on <html> while the React state thinks light.
(function syncInitialTheme() {
  try {
    const saved = window.localStorage.getItem('coldmail.theme');
    const isDark = saved === 'dark';
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch {
    document.documentElement.classList.remove('dark');
  }
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          borderRadius: '10px',
          background: '#171717',
          color: '#fafafa',
        },
        success: { iconTheme: { primary: '#22c55e', secondary: '#171717' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#171717' } },
      }}
    />
  </React.StrictMode>
);
