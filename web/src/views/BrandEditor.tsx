import { useState } from 'react';
import { api } from '../api';
import type { Brand, BrandArchetype, Mood } from '../types';
import { MOODS } from '../types';

interface Props {
  mode: 'create' | 'edit';
  brand: Brand;
  onCancel: () => void;
  onSaved: () => void;
}

export function BrandEditor({ mode, brand, onCancel, onSaved }: Props) {
  const [draft, setDraft] = useState<Brand>(structuredClone(brand));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<Brand>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const updatePrompts = (patch: Partial<Brand['prompts']>) =>
    setDraft((d) => ({ ...d, prompts: { ...d.prompts, ...patch } }));

  const updateCaption = (patch: Partial<Brand['caption']>) =>
    setDraft((d) => ({ ...d, caption: { ...d.caption, ...patch } }));

  const setArchetype = (i: number, patch: Partial<BrandArchetype>) =>
    setDraft((d) => ({
      ...d,
      archetypes: d.archetypes.map((a, idx) =>
        idx === i ? { ...a, ...patch } : a
      ),
    }));

  const addArchetype = () =>
    setDraft((d) => ({
      ...d,
      archetypes: [...d.archetypes, { id: '', label: '', guidance: '' }],
    }));

  const removeArchetype = (i: number) =>
    setDraft((d) => ({
      ...d,
      archetypes: d.archetypes.filter((_, idx) => idx !== i),
    }));

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const cleaned: Brand = {
        ...draft,
        archetypes: draft.archetypes.filter((a) => a.id && a.label),
      };
      if (mode === 'create') {
        await api.createBrand(cleaned);
      } else {
        await api.updateBrand(cleaned);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="editor">
      <h2>{mode === 'create' ? 'New brand' : `Edit "${brand.id}"`}</h2>

      <div className="field">
        <label>id (lowercase, hyphens; immutable in edit mode)</label>
        <input
          type="text"
          value={draft.id}
          disabled={mode === 'edit'}
          onChange={(e) => update({ id: e.target.value })}
          placeholder="goblin-frog-mall"
        />
      </div>

      <div className="field">
        <label>Display name</label>
        <input
          type="text"
          value={draft.displayName}
          onChange={(e) => update({ displayName: e.target.value })}
          placeholder="Goblin Frog at the Mall"
        />
      </div>

      <div className="field">
        <label>Music style hint (optional)</label>
        <input
          type="text"
          value={draft.musicStyleHint ?? ''}
          onChange={(e) =>
            update({ musicStyleHint: e.target.value || undefined })
          }
          placeholder="lo-fi mallcore with sample-pad swells"
        />
      </div>

      <h3>Prompts</h3>

      <div className="field">
        <label>storySystemFlavor (one phrase, e.g. "a goblin frog at the mall")</label>
        <input
          type="text"
          value={draft.prompts.storySystemFlavor ?? ''}
          onChange={(e) =>
            updatePrompts({ storySystemFlavor: e.target.value || undefined })
          }
        />
      </div>

      <div className="field">
        <label>storyCharacter (bullets describing the character)</label>
        <textarea
          className="long"
          value={draft.prompts.storyCharacter}
          onChange={(e) => updatePrompts({ storyCharacter: e.target.value })}
        />
      </div>

      <div className="field">
        <label>referenceSheet (text→image prompt for the canonical reference)</label>
        <textarea
          className="long"
          value={draft.prompts.referenceSheet}
          onChange={(e) => updatePrompts({ referenceSheet: e.target.value })}
        />
      </div>

      <div className="field">
        <label>sceneContinuity (one sentence injected into every scene prompt)</label>
        <textarea
          value={draft.prompts.sceneContinuity}
          onChange={(e) => updatePrompts({ sceneContinuity: e.target.value })}
        />
      </div>

      <div className="field">
        <label>evalCriteria (PASS / FAIL bullets for the VLM gate)</label>
        <textarea
          className="long"
          value={draft.prompts.evalCriteria}
          onChange={(e) => updatePrompts({ evalCriteria: e.target.value })}
        />
      </div>

      <h3>Archetypes</h3>
      {draft.archetypes.map((a, i) => (
        <div className="archetype-row" key={i}>
          <input
            type="text"
            placeholder="id (slug)"
            value={a.id}
            onChange={(e) => setArchetype(i, { id: e.target.value })}
          />
          <input
            type="text"
            placeholder="Label"
            value={a.label}
            onChange={(e) => setArchetype(i, { label: e.target.value })}
          />
          <textarea
            placeholder="Guidance (optional)"
            value={a.guidance ?? ''}
            onChange={(e) =>
              setArchetype(i, { guidance: e.target.value || undefined })
            }
          />
          <button onClick={() => removeArchetype(i)}>×</button>
        </div>
      ))}
      <button onClick={addArchetype}>+ Add archetype</button>

      <h3>Caption</h3>

      <div className="field">
        <label>Core hashtags (space-separated)</label>
        <input
          type="text"
          value={draft.caption.coreHashtags.join(' ')}
          onChange={(e) =>
            updateCaption({ coreHashtags: splitTags(e.target.value) })
          }
          placeholder="#goblinfrog #mallcore #frogtok"
        />
      </div>

      <div className="field">
        <label>Trending hashtags (space-separated)</label>
        <input
          type="text"
          value={(draft.caption.trendingHashtags ?? []).join(' ')}
          onChange={(e) =>
            updateCaption({ trendingHashtags: splitTags(e.target.value) })
          }
          placeholder="#fyp #foryou"
        />
      </div>

      <div className="field">
        <label>Closing CTAs (one per line)</label>
        <textarea
          value={draft.caption.closingCtas.join('\n')}
          onChange={(e) =>
            updateCaption({
              closingCtas: e.target.value.split('\n').filter(Boolean),
            })
          }
        />
      </div>

      <div className="field">
        <label>Mood hashtags (rows: "mood: #tag1 #tag2")</label>
        <textarea
          value={Object.entries(draft.caption.moodHashtags)
            .map(([m, tags]) => `${m}: ${(tags ?? []).join(' ')}`)
            .join('\n')}
          onChange={(e) =>
            updateCaption({ moodHashtags: parseMoodTags(e.target.value) })
          }
        />
      </div>

      <div className="field">
        <label>Archetype hashtags (rows: "archetypeId: #tag1 #tag2")</label>
        <textarea
          value={Object.entries(draft.caption.archetypeHashtags)
            .map(([id, tags]) => `${id}: ${tags.join(' ')}`)
            .join('\n')}
          onChange={(e) =>
            updateCaption({ archetypeHashtags: parseTags(e.target.value) })
          }
        />
      </div>

      <div className="field">
        <label>Archetype opening lines (rows: "archetypeId | one line")</label>
        <textarea
          className="long"
          value={Object.entries(draft.caption.archetypeOpenings)
            .flatMap(([id, lines]) => lines.map((l) => `${id} | ${l}`))
            .join('\n')}
          onChange={(e) =>
            updateCaption({ archetypeOpenings: parseOpenings(e.target.value) })
          }
        />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="footer">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save brand'}
        </button>
      </div>
    </div>
  );
}

function splitTags(s: string): string[] {
  return s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseTags(s: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of s.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    out[key] = splitTags(line.slice(idx + 1));
  }
  return out;
}

function parseMoodTags(s: string): Partial<Record<Mood, string[]>> {
  const all = parseTags(s);
  const out: Partial<Record<Mood, string[]>> = {};
  for (const m of MOODS) {
    if (all[m]) out[m] = all[m];
  }
  return out;
}

function parseOpenings(s: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of s.split('\n')) {
    const idx = line.indexOf('|');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!key || !val) continue;
    (out[key] ??= []).push(val);
  }
  return out;
}
