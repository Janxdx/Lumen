/* Registering the offline shell, and noticing when a newer one is ready.
 *
 * The service worker in public/sw.js deliberately never activates itself, so
 * something has to (a) keep asking whether a new build exists and (b) hand the
 * answer to the UI. That is this file. It exports a subscribe/get pair rather
 * than a hook so main.tsx can start it before React mounts — the check should
 * be in flight while the library is still loading.
 */

type Listener = (ready: boolean) => void;

let waiting: ServiceWorker | null = null;
let reloading = false;
const listeners = new Set<Listener>();

function announce(sw: ServiceWorker | null) {
  if (waiting === sw) return;
  waiting = sw;
  for (const l of listeners) l(Boolean(waiting));
}

/** Subscribe to "a newer build is installed and waiting". Returns unsubscribe. */
export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  listener(Boolean(waiting));
  return () => listeners.delete(listener);
}

/** Take the waiting build. Resolves into a reload, so nothing follows it. */
export function applyUpdate(): void {
  const sw = waiting;
  if (!sw || reloading) return;
  reloading = true;
  /* The reload is driven by controllerchange rather than fired here: post and
     reload together races the swap, and reloading a page the new worker has
     not claimed yet just re-runs the old one. */
  sw.postMessage({ type: 'SKIP_WAITING' });
}

/* How often to ask, while the app is in the foreground. An iPad PWA can sit
   resident for days without a single navigation, and a navigation is the only
   moment the browser checks on its own — which is exactly how an app ends up
   several builds behind with no way to notice. */
const POLL_MS = 60 * 60 * 1000;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  /* One reload, ever. Without the guard a worker that activates while the page
     is loading — or a second tab doing its own upgrade — reloads in a loop. */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading) return;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      /* 'none' keeps sw.js out of the HTTP cache for the update check. Browsers
         cap the worker script at 24h regardless, and a day is long enough for a
         deploy to look broken. */
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // already waiting from a previous visit
        if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            /* `controller` is null on the very first visit — there is no old
               version to replace, so this is an install, not an update, and
               the banner would be nonsense. */
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              announce(installing);
            }
          });
        });

        const check = () => {
          if (document.visibilityState !== 'visible') return;
          void reg.update().catch(() => undefined);
        };

        check();
        setInterval(check, POLL_MS);
        /* Coming back to a backgrounded PWA is the moment a check is most
           likely to find something and least likely to be in the way. */
        document.addEventListener('visibilitychange', check);
      })
      .catch(() => {
        /* offline support is a bonus, not a requirement */
      });
  });
}
