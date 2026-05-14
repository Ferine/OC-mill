import { useState } from 'react';
import { RunsView } from './views/RunsView';
import { BrandsView } from './views/BrandsView';

type View = 'runs' | 'brands';

export function App() {
  const [view, setView] = useState<View>('runs');

  return (
    <div className="app">
      <div className="top-nav">
        <span className="title">🐱 OC-mill</span>
        <button
          className={`tab ${view === 'runs' ? 'active' : ''}`}
          onClick={() => setView('runs')}
        >
          Runs
        </button>
        <button
          className={`tab ${view === 'brands' ? 'active' : ''}`}
          onClick={() => setView('brands')}
        >
          Brands
        </button>
        <div className="grow" />
      </div>
      {view === 'runs' ? <RunsView /> : <BrandsView />}
    </div>
  );
}
