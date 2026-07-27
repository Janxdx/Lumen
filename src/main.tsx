import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/* Double-tap zoom and pinch fight a paginated reader; both are disabled. */
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

/* Offline shell. Registered only in a production build so the dev server
   isn't shadowed by a stale cache. */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is a bonus, not a requirement */
    });
  });
}

/* Ask for persistent storage: without it Safari may evict IndexedDB — the
   imported books — after about a week of not opening the app. Granted
   silently for home-screen installs; a no-op everywhere it isn't supported. */
void navigator.storage?.persist?.().catch(() => undefined);
