import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Brand } from '../types';
import { BrandEditor } from './BrandEditor';

const EMPTY_BRAND: Brand = {
  id: '',
  displayName: '',
  version: 1,
  prompts: {
    storySystemFlavor: '',
    storyCharacter: '',
    referenceSheet: '',
    sceneContinuity: '',
    evalCriteria: '',
  },
  archetypes: [{ id: '', label: '', guidance: '' }],
  caption: {
    coreHashtags: [],
    moodHashtags: {},
    archetypeHashtags: {},
    archetypeOpenings: {},
    closingCtas: [''],
  },
};

export function BrandsView() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [editing, setEditing] = useState<
    { mode: 'create' | 'edit'; brand: Brand } | undefined
  >();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setBrands(await api.listBrands());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (editing) {
    return (
      <BrandEditor
        mode={editing.mode}
        brand={editing.brand}
        onCancel={() => setEditing(undefined)}
        onSaved={async () => {
          setEditing(undefined);
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="brands-layout">
      <div className="detail-header">
        <h2>Brands ({brands.length})</h2>
        <div className="actions">
          <button
            className="primary"
            onClick={() =>
              setEditing({ mode: 'create', brand: { ...EMPTY_BRAND } })
            }
          >
            + New brand
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="brands-grid">
        {brands.map((b) => (
          <div className="brand-card" key={b.id}>
            <h3>{b.displayName}</h3>
            <div className="id">{b.id}</div>
            <div className="muted">
              {b.archetypes.length} archetype
              {b.archetypes.length === 1 ? '' : 's'}
            </div>
            <div className="row">
              <button onClick={() => setEditing({ mode: 'edit', brand: b })}>
                Edit
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (!confirm(`Delete brand "${b.id}"?`)) return;
                  try {
                    await api.deleteBrand(b.id);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {brands.length === 0 && (
          <div className="empty">No brands yet.</div>
        )}
      </div>
    </div>
  );
}
