// OC-Mill local UI. Vanilla JS, no build step.

const state = {
  runs: [],
  selectedId: null,
  detail: null,
  events: [],
  sse: null,
  // Per-scene live status overrides applied from SSE events on top of
  // whatever the server reported in /api/runs/:id.
  sceneLive: {},
};

const $ = (sel) => document.querySelector(sel);

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString();
}

function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// ---------- Data layer ----------

async function loadRuns() {
  const res = await fetch('/api/runs');
  state.runs = await res.json();
  renderRuns();
}

async function loadDetail(runId) {
  const res = await fetch('/api/runs/' + encodeURIComponent(runId));
  if (!res.ok) {
    state.detail = null;
    return;
  }
  state.detail = await res.json();
  state.sceneLive = {}; // reset live overrides
  renderDetail();
}

function selectRun(runId) {
  if (state.sse) {
    state.sse.close();
    state.sse = null;
  }
  state.selectedId = runId;
  state.events = [];
  renderRuns();

  loadDetail(runId).then(() => {
    state.sse = new EventSource(
      '/api/runs/' + encodeURIComponent(runId) + '/events'
    );
    state.sse.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        if (event.type === 'no-active-run') {
          state.sse.close();
          state.sse = null;
          return;
        }
        state.events.push(event);
        applyEvent(event);
        renderDetail();
      } catch (e) {
        console.error('bad sse payload', e, msg.data);
      }
    };
    state.sse.onerror = () => {
      // Server may have closed (run completed); browser will reconnect by default.
      // We'll just leave it.
    };
  });
}

async function startNewRun() {
  $('#btn-new').disabled = true;
  try {
    const res = await fetch('/api/runs', { method: 'POST' });
    const { runId } = await res.json();
    await loadRuns();
    selectRun(runId);
  } finally {
    $('#btn-new').disabled = false;
  }
}

async function resumeRun(runId) {
  await fetch('/api/runs/' + encodeURIComponent(runId) + '/resume', {
    method: 'POST',
  });
  await loadRuns();
  selectRun(runId);
}

// ---------- Live event reducer ----------

function ensureScene(sceneIndex) {
  if (!state.sceneLive[sceneIndex]) {
    state.sceneLive[sceneIndex] = {
      keyframe: 'pending',
      clip: 'pending',
      narration: 'pending',
    };
  }
  return state.sceneLive[sceneIndex];
}

function applyEvent(event) {
  switch (event.type) {
    case 'scene.keyframe.start':
      ensureScene(event.sceneIndex).keyframe = 'running';
      break;
    case 'scene.keyframe.ready': {
      const s = ensureScene(event.sceneIndex);
      s.keyframe = event.fromCache ? 'cached' : event.evalPassed ? 'done' : 'failed';
      s.keyframeBytes = event.bytes;
      s.evalPassed = event.evalPassed;
      break;
    }
    case 'scene.keyframe.evalFail':
      ensureScene(event.sceneIndex).keyframe = 'running'; // retrying
      break;
    case 'scene.clip.start':
      ensureScene(event.sceneIndex).clip = 'running';
      break;
    case 'scene.clip.ready': {
      const s = ensureScene(event.sceneIndex);
      s.clip = event.fromCache ? 'cached' : 'done';
      s.clipBytes = event.bytes;
      break;
    }
    case 'scene.narration.start':
      ensureScene(event.sceneIndex).narration = 'running';
      break;
    case 'scene.narration.ready': {
      const s = ensureScene(event.sceneIndex);
      s.narration = event.fromCache ? 'cached' : 'done';
      break;
    }
    case 'story.ready':
      // Reload the detail to pick up the freshly-persisted story.
      loadDetail(state.selectedId);
      break;
    case 'compose.done':
    case 'run.success':
    case 'run.failure':
      // Refresh detail to pick up final.mp4 + status changes.
      loadDetail(state.selectedId);
      // Also refresh sidebar so the run-level status badge updates.
      loadRuns();
      break;
  }
}

// ---------- Rendering ----------

function renderRuns() {
  const ul = $('#run-list');
  ul.innerHTML = '';
  if (state.runs.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No runs yet.';
    ul.appendChild(li);
    return;
  }
  for (const r of state.runs) {
    const li = document.createElement('li');
    if (r.runId === state.selectedId) li.classList.add('active');
    li.onclick = () => selectRun(r.runId);
    li.innerHTML = `
      <div class="run-id">${escapeHtml(r.runId)}</div>
      <div class="run-title">${escapeHtml(r.storyTitle ?? '(no story yet)')}</div>
      <div class="run-meta">
        <span class="badge ${r.status}">${r.status}</span>
        ${r.archetype ? `<span class="muted">${escapeHtml(r.archetype)}</span>` : ''}
        ${r.sceneCount ? `<span class="muted">${r.sceneCount} scenes</span>` : ''}
      </div>
    `;
    ul.appendChild(li);
  }
}

function renderDetail() {
  const root = $('#detail');
  if (!state.detail) {
    root.innerHTML = '<p class="muted">Select a run from the sidebar, or start a new one.</p>';
    return;
  }
  const d = state.detail;
  const showResume = d.status === 'failed' || (!d.hasFinal && !d.active);

  let html = `
    <div class="detail-header">
      <div>
        <h2>${escapeHtml(d.storyTitle ?? d.runId)}</h2>
        <div class="muted">
          <span class="run-id">${escapeHtml(d.runId)}</span>
          · <span class="badge ${d.status}">${d.status}</span>
          ${d.archetype ? '· ' + escapeHtml(d.archetype) : ''}
          ${d.startedAtMs ? '· started ' + escapeHtml(fmtTime(d.startedAtMs)) : ''}
        </div>
      </div>
      <div class="actions">
        ${showResume ? `<button class="primary" onclick="resumeRun('${escapeAttr(d.runId)}')">Resume</button>` : ''}
      </div>
    </div>
  `;

  if (d.hasFinal) {
    html += `
      <div class="final-video">
        <video controls src="/api/runs/${encodeURIComponent(d.runId)}/files/final.mp4"></video>
      </div>
    `;
  }

  if (d.scenes && d.scenes.length > 0) {
    html += '<div class="scene-grid">';
    for (const s of d.scenes) {
      html += renderSceneCard(d, s);
    }
    html += '</div>';
  } else if (d.status === 'running') {
    html += '<p class="muted">Generating story…</p>';
  }

  if (state.events.length > 0) {
    html += renderEventLog();
  }

  root.innerHTML = html;
}

function renderSceneCard(detail, scene) {
  const live = state.sceneLive[scene.sceneIndex] || {};
  const sceneMeta = detail.story?.scenes?.[scene.sceneIndex];

  // Combine on-disk state with live event state
  const kfStatus = live.keyframe ?? (scene.keyframe.exists
    ? (scene.keyframe.evalPassed === false ? 'failed' : 'done')
    : 'pending');
  const clipStatus = live.clip ?? (scene.clip.exists ? 'done' : 'pending');
  const narrStatus = live.narration ?? (scene.narration.exists ? 'done' : 'pending');

  let frame = `<div class="placeholder">Scene ${scene.sceneIndex}</div>`;
  const runId = encodeURIComponent(detail.runId);
  if (clipStatus === 'done' || clipStatus === 'cached') {
    const clipUrl = `/api/runs/${runId}/files/clips/scene-${pad(scene.sceneIndex)}-clip.mp4`;
    frame = `<video src="${clipUrl}" muted preload="metadata"
              onmouseover="this.play()" onmouseout="this.pause();this.currentTime=0"></video>`;
  } else if (kfStatus === 'done' || kfStatus === 'cached') {
    const imgUrl = `/api/runs/${runId}/files/keyframes/scene-${pad(scene.sceneIndex)}-keyframe.png`;
    frame = `<img src="${imgUrl}" alt="scene ${scene.sceneIndex}" />`;
  }

  return `
    <div class="scene-card">
      <div class="frame">${frame}</div>
      <div class="meta">
        <div class="title">Scene ${scene.sceneIndex}</div>
        <div class="subtitle">${escapeHtml(sceneMeta?.subtitleText ?? '')}</div>
        <div class="stage-row">
          <span class="stage-pill ${kfStatus}" title="Keyframe">KF</span>
          <span class="stage-pill ${clipStatus}" title="Clip">CL</span>
          <span class="stage-pill ${narrStatus}" title="Narration">NA</span>
        </div>
      </div>
    </div>
  `;
}

function renderEventLog() {
  const tail = state.events.slice(-200);
  let html = '<section class="event-log"><header>Events</header><ol>';
  for (const e of tail) {
    const cls =
      e.type === 'run.failure' ? 'failure' :
      e.type === 'run.success' ? 'success' : '';
    const summary = formatEvent(e);
    html += `<li class="${cls}"><span class="ts">${e.type}</span>${escapeHtml(summary)}</li>`;
  }
  html += '</ol></section>';
  return html;
}

function formatEvent(e) {
  switch (e.type) {
    case 'run.start':
      return e.runDir + (e.resuming ? ' (resuming)' : '');
    case 'story.ready':
      return `${e.story.title} — ${e.story.scenes.length} scenes${e.fromCache ? ' (cached)' : ''}`;
    case 'stage.start':
    case 'stage.done':
      return e.stage;
    case 'scene.keyframe.start':
      return `scene ${e.sceneIndex}, attempt ${e.attempt}`;
    case 'scene.keyframe.ready':
      return `scene ${e.sceneIndex}, ${fmtBytes(e.bytes)}, eval ${e.evalPassed ? '✓' : '✗'}${e.fromCache ? ' (cached)' : ''}`;
    case 'scene.keyframe.evalFail':
      return `scene ${e.sceneIndex}, attempt ${e.attempt}: ${e.feedback.slice(0, 140)}`;
    case 'scene.clip.start':
      return `scene ${e.sceneIndex}`;
    case 'scene.clip.ready':
      return `scene ${e.sceneIndex}, ${fmtBytes(e.bytes)}, ${e.durationSeconds}s${e.fromCache ? ' (cached)' : ''}`;
    case 'scene.narration.start':
      return `scene ${e.sceneIndex}`;
    case 'scene.narration.ready':
      return `scene ${e.sceneIndex}, ${fmtBytes(e.bytes)}${e.fromCache ? ' (cached)' : ''}`;
    case 'compose.done':
      return e.path;
    case 'upload.done':
      return `post ${e.postId}${e.shareUrl ? ' — ' + e.shareUrl : ''}`;
    case 'run.success':
      return `post ${e.tiktokPostId ?? '(unknown)'}`;
    case 'run.failure':
      return e.error;
    default:
      return JSON.stringify(e);
  }
}

// ---------- Utilities ----------

function pad(n) { return String(n).padStart(2, '0'); }

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- Init ----------

window.resumeRun = resumeRun; // for inline onclick
$('#btn-new').onclick = startNewRun;
$('#btn-refresh').onclick = () => {
  loadRuns();
  if (state.selectedId) loadDetail(state.selectedId);
};

loadRuns();
// Light polling as a backup so the run list stays fresh even when nothing
// in flight has the SSE channel open.
setInterval(loadRuns, 10_000);
