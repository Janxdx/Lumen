import { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady } from '../pwa/update';

/* Offered, never imposed. A new build is ready the moment it finishes
   downloading, which is regularly in the middle of a page — so this waits for a
   tap and the reader decides when to lose their place in the layout. */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [taken, setTaken] = useState(false);

  useEffect(() => onUpdateReady(setReady), []);

  if (!ready) return null;

  return (
    <button
      className="toast update"
      onClick={() => {
        setTaken(true);
        applyUpdate();
      }}
      aria-live="polite"
    >
      <span className="update-dot" />
      {taken ? 'Updating…' : 'A new version is ready'}
      {!taken && <span className="update-action">Update</span>}
    </button>
  );
}
