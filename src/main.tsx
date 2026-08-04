import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './pwa/update';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/* Double-tap zoom and pinch fight a paginated reader; both are disabled. */
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

/* Offline shell. Registered only in a production build so the dev server
   isn't shadowed by a stale cache. The worker installs a new build but does
   not activate it; registerServiceWorker keeps asking whether one is waiting
   and UpdateBanner offers it. */
if (import.meta.env.PROD) registerServiceWorker();

/* Ask for persistent storage: without it Safari may evict IndexedDB — the
   imported books — after about a week of not opening the app. Granted
   silently for home-screen installs; a no-op everywhere it isn't supported. */
void navigator.storage?.persist?.().catch(() => undefined);
