import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fileUrl } from '../api';
import { useRunEvents } from '../hooks/useRunEvents';
import type {
  Brand,
  PipelineEvent,
  RunDetail,
  RunSummary,
} from '../types';

export function RunsView() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const list = await api.listRuns();
      setRuns(list);
      if (!activeId && list.length > 0) setActiveId(list[0].runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    api.listBrands().then(setBrands).catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="runs-layout">
      <div className="sidebar">
        <div style={{ padding: '12px 16px' }}>
          <button className="primary" onClick={() => setNewRunOpen(true)}>
            + New run
          </button>
        </div>
        <h2>Runs ({runs.length})</h2>
        <ul className="run-list">
          {runs.map((r) => (
            <li
              key={r.runId}
              className={r.runId === activeId ? 'active' : ''}
              onClick={() => setActiveId(r.runId)}
            >
              <div className="run-id">{r.runId}</div>
              <div className="run-title">{r.storyTitle ?? '(no story yet)'}</div>
              <div className="run-meta">
                <span className={`badge ${r.status}`}>{r.status}</span>
                {r.archetype && <span className="muted">{r.archetype}</span>}
                {r.sceneCount != null && (
                  <span className="muted">· {r.sceneCount} scenes</span>
                )}
              </div>
            </li>
          ))}
          {runs.length === 0 && <li className="muted">No runs yet.</li>}
        </ul>
      </div>
      <div className="detail">
        {error && <div className="error">{error}</div>}
        {activeId ? (
          <RunDetailPane runId={activeId} onChanged={refresh} />
        ) : (
          <div className="empty">Select a run, or start a new one.</div>
        )}
      </div>
      {newRunOpen && (
        <NewRunModal
          brands={brands}
          onClose={() => setNewRunOpen(false)}
          onStarted={async (id) => {
            setNewRunOpen(false);
            await refresh();
            setActiveId(id);
          }}
        />
      )}
    </div>
  );
}

function RunDetailPane({
  runId,
  onChanged,
}: {
  runId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<RunDetail>();
  const [error, setError] = useState<string>();
  const events = useRunEvents(runId);

  const refresh = useCallback(async () => {
    try {
      setDetail(await api.getRun(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Refresh on every event so the scene grid follows the SSE stream.
  useEffect(() => {
    if (events.length > 0) refresh();
  }, [events.length, refresh]);

  if (!detail) {
    return <div className="empty">{error ?? 'Loading…'}</div>;
  }

  const finalUrl = detail.hasFinal ? fileUrl(runId, 'final.mp4') : undefined;

  return (
    <>
      <div className="detail-header">
        <div>
          <h2>{detail.storyTitle ?? '(no story)'}</h2>
          <div className="muted run-id">{detail.runId}</div>
          <div className="run-meta">
            <span className={`badge ${detail.status}`}>{detail.status}</span>
            {detail.story && (
              <>
                <span className="muted">brand: {detail.story.brandId}</span>
                <span className="muted">· {detail.story.archetypeId}</span>
                <span className="muted">
                  · {detail.story.scenes.length} scenes
                </span>
              </>
            )}
          </div>
        </div>
        <div className="actions">
          <button
            onClick={async () => {
              try {
                await api.resumeRun(runId);
                onChanged();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            ↻ Resume
          </button>
        </div>
      </div>

      {finalUrl && (
        <div className="final-video">
          <video controls src={finalUrl} />
        </div>
      )}

      {detail.story && (
        <div className="scene-grid">
          {detail.story.scenes.map((s, i) => {
            const file = detail.scenes[i];
            return (
              <div className="scene-card" key={i}>
                <div className="frame">
                  {file?.keyframe.exists ? (
                    <img
                      src={fileUrl(
                        runId,
                        `keyframes/scene-${String(i).padStart(2, '0')}-keyframe.png`
                      )}
                      alt=""
                    />
                  ) : (
                    <span className="placeholder">scene {i + 1}</span>
                  )}
                </div>
                <div className="meta">
                  <div className="title">Scene {i + 1} · {s.mood}</div>
                  <div className="subtitle">{s.subtitleText}</div>
                  <div className="stage-row">
                    <span
                      className={`stage-pill ${
                        file?.keyframe.exists ? 'done' : ''
                      }`}
                    >
                      kf
                    </span>
                    <span
                      className={`stage-pill ${
                        file?.clip.exists ? 'done' : ''
                      }`}
                    >
                      clip
                    </span>
                    <span
                      className={`stage-pill ${
                        file?.narration.exists ? 'done' : ''
                      }`}
                    >
                      tts
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <EventLog events={events} />
      {error && <div className="error">{error}</div>}
    </>
  );
}

function EventLog({ events }: { events: PipelineEvent[] }) {
  const formatted = useMemo(
    () =>
      events.map((e, i) => ({
        i,
        text: JSON.stringify(e),
      })),
    [events]
  );
  return (
    <div className="event-log">
      <div className="head">Live events ({events.length})</div>
      <ol>
        {formatted.length === 0 && <li className="muted">No events yet.</li>}
        {formatted.map((e) => (
          <li key={e.i}>{e.text}</li>
        ))}
      </ol>
    </div>
  );
}

function NewRunModal({
  brands,
  onClose,
  onStarted,
}: {
  brands: Brand[];
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const [brandId, setBrandId] = useState(brands[0]?.id ?? '');
  const [archetypeId, setArchetypeId] = useState('');
  const [seed, setSeed] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string>();

  const brand = brands.find((b) => b.id === brandId);

  const suggestSeed = async () => {
    if (!brandId) return;
    setSuggesting(true);
    setError(undefined);
    try {
      const { seed: s } = await api.suggestSeed(
        brandId,
        archetypeId || undefined
      );
      setSeed(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Start a new run</h3>

        <div className="field">
          <label>Brand</label>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName} ({b.id})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Archetype (optional — random if blank)</label>
          <select
            value={archetypeId}
            onChange={(e) => setArchetypeId(e.target.value)}
          >
            <option value="">— random —</option>
            {brand?.archetypes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.id})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Creative seed (optional, ≤ 500 chars)</span>
            <button
              type="button"
              onClick={suggestSeed}
              disabled={suggesting || !brandId}
              style={{ padding: '2px 8px', fontSize: 12 }}
              title="Let the LLM write one for you"
            >
              {suggesting ? '✨ thinking…' : '✨ Surprise me'}
            </button>
          </label>
          <textarea
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            maxLength={500}
            placeholder="e.g. but the whole story takes place in a flooded car wash"
          />
        </div>

        {error && <div className="error">{error}</div>}

        <div className="footer">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={submitting || !brandId}
            onClick={async () => {
              setSubmitting(true);
              try {
                const res = await api.startRun({
                  brandId,
                  archetypeId: archetypeId || undefined,
                  seed: seed.trim() || undefined,
                });
                onStarted(res.runId);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setSubmitting(false);
              }
            }}
          >
            {submitting ? 'Starting…' : 'Start run'}
          </button>
        </div>
      </div>
    </div>
  );
}
