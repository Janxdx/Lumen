import { useEffect, useState } from 'react';
import { useLibrary } from './store/library';
import { resolveTheme, useSettings } from './store/settings';
import { Library } from './ui/Library';
import { Stats } from './ui/Stats';
import { Reader } from './ui/Reader';
import { IconLibrary, IconStats } from './ui/Icons';

export default function App() {
  const [tab, setTab] = useState<'library' | 'stats'>('library');
  const [reading, setReading] = useState<string | null>(null);
  const load = useLibrary((s) => s.load);
  const loading = useLibrary((s) => s.loading);
  const mode = useSettings((s) => s.mode);

  useEffect(() => {
    void load();
  }, [load]);

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
      ) : (
        <Stats />
      )}

      {!reading && (
        <nav className="tabbar">
          <button
            className={tab === 'library' ? 'on' : ''}
            onClick={() => setTab('library')}
          >
            <IconLibrary size={18} /> Library
          </button>
          <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>
            <IconStats size={18} /> Statistics
          </button>
        </nav>
      )}

      {reading && <Reader bookId={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
