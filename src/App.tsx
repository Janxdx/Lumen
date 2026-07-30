import { useEffect, useState } from 'react';
import { useLibrary } from './store/library';
import { useAuth } from './store/auth';
import { resolveTheme, useSettings } from './store/settings';
import { initSync, useSync } from './sync/sync';
import { syncEnabled } from './sync/client';
import { useDevice } from './store/device';
import { Library } from './ui/Library';
import { Stats } from './ui/Stats';
import { Account } from './ui/Account';
import { Device } from './ui/Device';
import { Reader } from './ui/Reader';
import { IconAccount, IconDevice, IconLibrary, IconStats } from './ui/Icons';

type Tab = 'library' | 'device' | 'stats' | 'account';

export default function App() {
  const [tab, setTab] = useState<Tab>('library');
  const [reading, setReading] = useState<string | null>(null);
  const load = useLibrary((s) => s.load);
  const loading = useLibrary((s) => s.loading);
  const mode = useSettings((s) => s.mode);
  const signedIn = useAuth((s) => Boolean(s.user));
  const timerRunning = useDevice((s) => Boolean(s.timer?.runningSince));

  useEffect(() => {
    void load();
  }, [load]);

  /* The device shelf loads alongside the library, and every time the library
     changes size the matcher runs: importing an EPUB you have been reading
     on the e-reader should link the two without you asking. */
  useEffect(() => {
    void (async () => {
      await useDevice.getState().load();
      await useDevice.getState().autoLink();
    })();
    let count = useLibrary.getState().books.length;
    return useLibrary.subscribe((s) => {
      if (s.books.length === count) return;
      count = s.books.length;
      void useDevice.getState().autoLink();
    });
  }, []);

  /* Account and sync boot. Neither blocks the library from rendering: the
     session is restored in the background and a sync is kicked off once an
     account is known, so a cold start on the sofa still opens instantly. */
  useEffect(() => {
    if (!syncEnabled) return;
    useAuth.getState().init();
    initSync();
    void useSync.getState().init();
    return useAuth.subscribe((s, prev) => {
      if (s.user && s.user.id !== prev.user?.id) void useSync.getState().syncNow();
    });
  }, []);

  /* theme follows the setting, and tracks the system when set to auto */
  useEffect(() => {
    const apply = () => {
      const theme = resolveTheme(mode);
      document.documentElement.dataset.theme = theme;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute('content', theme === 'ink' ? '#0E0D0C' : theme === 'sepia' ? '#F3E9D8' : '#FAF7F2');
      }
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);

  return (
    <div className="app">
      {loading ? (
        <div style={{ flex: 1 }} />
      ) : tab === 'library' ? (
        <Library onOpen={setReading} />
      ) : tab === 'device' ? (
        <Device />
      ) : tab === 'stats' ? (
        <Stats />
      ) : (
        <Account />
      )}

      {!reading && (
        <nav className="tabbar">
          <button
            className={tab === 'library' ? 'on' : ''}
            onClick={() => setTab('library')}
          >
            <IconLibrary size={18} /> Library
          </button>
          <button className={tab === 'device' ? 'on' : ''} onClick={() => setTab('device')}>
            <IconDevice size={18} /> Reader
            {timerRunning && <i className="dot live" aria-hidden />}
          </button>
          <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>
            <IconStats size={18} /> Statistics
          </button>
          <button
            className={tab === 'account' ? 'on' : ''}
            onClick={() => setTab('account')}
          >
            <IconAccount size={18} /> Account
            {syncEnabled && !signedIn && <i className="dot" aria-hidden />}
          </button>
        </nav>
      )}

      {reading && <Reader bookId={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
