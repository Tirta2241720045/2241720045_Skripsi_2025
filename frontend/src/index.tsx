import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

serviceWorkerRegistration.register({
  onSuccess: () => {
    console.info('[PWA] StegoShield siap digunakan secara offline.');
  },

  onUpdate: (registration) => {
    const confirmed = window.confirm(
      'Versi baru StegoShield tersedia. Perbarui sekarang?'
    );
    if (confirmed && registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  },

  onOffline: () => {
    console.warn('[PWA] Koneksi terputus. Aplikasi berjalan dalam mode offline.');
  },

  onOnline: () => {
    console.info('[PWA] Koneksi kembali tersedia.');
  },
});