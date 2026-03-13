import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { RunActions } from '../actions/run-actions.ts';
import type { AppConfig } from '../config.ts';

export interface PanelServerHooks {
  onAbort?: () => void;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, string>;
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RalphLoop Panel</title>
  <style>
    :root {
      --bg: #0f1117;
      --bg-subtle: #161822;
      --ink: #e4e6ed;
      --ink-muted: #8b8fa3;
      --card: #1a1d2b;
      --card-hover: #1f2235;
      --line: #2a2d3d;
      --accent: #6c8cff;
      --accent-soft: rgba(108, 140, 255, 0.12);
      --success: #34d399;
      --success-soft: rgba(52, 211, 153, 0.12);
      --warn: #fbbf24;
      --warn-soft: rgba(251, 191, 36, 0.12);
      --danger: #f87171;
      --danger-soft: rgba(248, 113, 113, 0.12);
      --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
      --sans: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
      --radius: 12px;
      --radius-sm: 8px;
      --shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 14px; }
    body {
      color: var(--ink);
      font-family: var(--sans);
      background: var(--bg);
      line-height: 1.5;
      min-height: 100vh;
    }

    /* ── Header bar ─────────────────────────────────────────── */
    .topbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      background: rgba(15, 17, 23, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
    }
    .topbar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
    }
    .topbar-brand .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--ink-muted);
      flex-shrink: 0;
    }
    .topbar-brand .dot.running { background: var(--success); box-shadow: 0 0 8px var(--success); }
    .topbar-brand .dot.paused  { background: var(--warn);    box-shadow: 0 0 8px var(--warn); }
    .topbar-brand .dot.failed,
    .topbar-brand .dot.aborted { background: var(--danger);  box-shadow: 0 0 8px var(--danger); }
    .topbar-actions { display: flex; gap: 8px; }

    /* ── Buttons ────────────────────────────────────────────── */
    button {
      border: none;
      border-radius: var(--radius-sm);
      padding: 7px 16px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      font-family: var(--sans);
      transition: background 0.15s, transform 0.1s;
    }
    button:active { transform: scale(0.97); }
    button.primary   { background: var(--accent); color: #fff; }
    button.primary:hover { background: #5a7ae6; }
    button.secondary { background: var(--line); color: var(--ink); }
    button.secondary:hover { background: #363a4f; }
    button.warn   { background: var(--warn-soft); color: var(--warn); border: 1px solid rgba(251,191,36,0.25); }
    button.warn:hover { background: rgba(251,191,36,0.2); }
    button.danger { background: var(--danger-soft); color: var(--danger); border: 1px solid rgba(248,113,113,0.25); }
    button.danger:hover { background: rgba(248,113,113,0.2); }

    /* ── Layout ─────────────────────────────────────────────── */
    main { max-width: 1360px; margin: 0 auto; padding: 20px 24px 48px; }

    /* ── KPI row ────────────────────────────────────────────── */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 20px;
    }
    .kpi {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px 18px;
      transition: border-color 0.2s;
    }
    .kpi:hover { border-color: var(--accent); }
    .kpi-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-muted); margin-bottom: 6px; }
    .kpi-value { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.03em; }
    .kpi-meta  { font-size: 0.8rem; color: var(--ink-muted); margin-top: 6px; line-height: 1.4; }

    /* ── Grid ───────────────────────────────────────────────── */
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px; }
    .span-4  { grid-column: span 4; }
    .span-5  { grid-column: span 5; }
    .span-6  { grid-column: span 6; }
    .span-7  { grid-column: span 7; }
    .span-8  { grid-column: span 8; }
    .span-12 { grid-column: span 12; }

    /* ── Card ───────────────────────────────────────────────── */
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
    }
    .card-header h2 { font-size: 0.95rem; font-weight: 700; }
    .card-body { padding: 14px 18px; flex: 1; overflow-y: auto; }
    .card-body.no-pad { padding: 0; }

    /* ── Chat-style Q&A ────────────────────────────────────── */
    .chat-list { display: flex; flex-direction: column; gap: 12px; }
    .chat-bubble {
      border-radius: var(--radius);
      padding: 12px 14px;
      max-width: 100%;
      line-height: 1.5;
    }
    .chat-bubble.question {
      background: var(--accent-soft);
      border: 1px solid rgba(108,140,255,0.2);
      border-left: 3px solid var(--accent);
    }
    .chat-bubble.answer {
      background: var(--success-soft);
      border: 1px solid rgba(52,211,153,0.2);
      border-left: 3px solid var(--success);
    }
    .chat-bubble .chat-id {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--ink-muted);
      margin-bottom: 4px;
    }
    .chat-bubble .chat-text { font-size: 0.9rem; }
    .chat-bubble .chat-meta {
      font-size: 0.75rem;
      color: var(--ink-muted);
      margin-top: 6px;
    }
    .answer-form {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .answer-form textarea {
      flex: 1;
      resize: vertical;
      min-height: 40px;
    }
    .answer-form button {
      align-self: flex-end;
      white-space: nowrap;
    }

    /* ── Injection items ───────────────────────────────────── */
    .inject-item {
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
    }
    .inject-item:last-child { border-bottom: none; }
    .inject-item .kind-badge {
      display: inline-block;
      font-size: 0.7rem;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      padding: 2px 8px;
      border-radius: 4px;
      margin-right: 6px;
    }
    .inject-item .kind-badge.answer { background: var(--success-soft); color: var(--success); }
    .inject-item .kind-badge.note   { background: var(--accent-soft);  color: var(--accent); }
    .inject-item .inject-text { margin-top: 4px; font-size: 0.88rem; }

    /* ── Blocker items ─────────────────────────────────────── */
    .blocker-item {
      padding: 10px 14px;
      border-left: 3px solid var(--danger);
      background: var(--danger-soft);
      border-radius: var(--radius-sm);
      margin-bottom: 8px;
    }
    .blocker-item:last-child { margin-bottom: 0; }
    .blocker-item .blocker-id {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--ink-muted);
      margin-bottom: 2px;
    }

    /* ── Note form ─────────────────────────────────────────── */
    .note-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .note-form textarea {
      resize: vertical;
    }

    /* ── Forms ──────────────────────────────────────────────── */
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      background: var(--bg-subtle);
      color: var(--ink);
      font: inherit;
      font-size: 0.9rem;
      transition: border-color 0.15s;
    }
    textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    textarea::placeholder { color: var(--ink-muted); }

    /* ── Log pre blocks ────────────────────────────────────── */
    pre {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      background: var(--bg);
      color: var(--ink);
      border-radius: 0;
      padding: 14px 18px;
      font-family: var(--mono);
      font-size: 0.8rem;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.55;
    }

    /* ── Event log ─────────────────────────────────────────── */
    .event-list { display: flex; flex-direction: column; }
    .event-row {
      display: flex;
      gap: 10px;
      padding: 6px 18px;
      font-size: 0.82rem;
      font-family: var(--mono);
      border-bottom: 1px solid rgba(42,45,61,0.5);
      align-items: baseline;
    }
    .event-row:hover { background: var(--bg-subtle); }
    .event-row .ev-time { color: var(--ink-muted); white-space: nowrap; flex-shrink: 0; width: 80px; }
    .event-row .ev-level { width: 14px; flex-shrink: 0; text-align: center; }
    .event-row .ev-level.info    { color: var(--accent); }
    .event-row .ev-level.warning { color: var(--warn); }
    .event-row .ev-level.error   { color: var(--danger); }
    .event-row .ev-type { color: var(--ink-muted); white-space: nowrap; flex-shrink: 0; width: 140px; }
    .event-row .ev-msg  { flex: 1; color: var(--ink); }

    /* ── Badge / pill ──────────────────────────────────────── */
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .pill.muted   { background: var(--line); color: var(--ink-muted); }
    .pill.accent  { background: var(--accent-soft); color: var(--accent); }
    .pill.success { background: var(--success-soft); color: var(--success); }
    .pill.warn    { background: var(--warn-soft); color: var(--warn); }
    .pill.danger  { background: var(--danger-soft); color: var(--danger); }

    /* ── Status colors ─────────────────────────────────────── */
    .status-idle      { color: var(--ink-muted); }
    .status-starting  { color: var(--accent); }
    .status-running   { color: var(--success); }
    .status-paused    { color: var(--warn); }
    .status-completed { color: var(--accent); }
    .status-failed    { color: var(--danger); }
    .status-aborted   { color: var(--danger); }

    /* ── Empty state ───────────────────────────────────────── */
    .empty { color: var(--ink-muted); font-style: italic; padding: 16px 0; text-align: center; font-size: 0.85rem; }

    /* ── Refresh indicator ─────────────────────────────────── */
    .refresh-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--success);
      display: inline-block;
      margin-right: 6px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* ── Responsive ────────────────────────────────────────── */
    @media (max-width: 1024px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .span-4, .span-5, .span-6, .span-7, .span-8, .span-12 { grid-column: span 12; }
    }
    @media (max-width: 640px) {
      .kpi-row { grid-template-columns: 1fr; }
      .topbar { flex-direction: column; gap: 10px; align-items: stretch; text-align: center; }
      .topbar-brand { justify-content: center; }
      .topbar-actions { flex-wrap: wrap; justify-content: center; }
      .topbar-actions button { flex: 1; min-width: 80px; padding: 10px 16px; }
      main { padding: 12px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-brand">
      <span id="statusDot" class="dot"></span>
      <span>RalphLoop Panel</span>
    </div>
    <div class="topbar-actions">
      <button class="secondary" onclick="refreshDashboard()">
        <span class="refresh-dot"></span>Refresh
      </button>
      <button class="warn" onclick="postAction('/api/pause')">⏸ Pause</button>
      <button class="primary" onclick="postAction('/api/resume')">▶ Resume</button>
      <button class="danger" onclick="postAction('/api/abort')">✕ Abort</button>
    </div>
  </header>

  <main>
    <section class="kpi-row">
      <article class="kpi">
        <div class="kpi-label">Run State</div>
        <div id="lifecycle" class="kpi-value">-</div>
        <div id="statusMeta" class="kpi-meta"></div>
      </article>
      <article class="kpi">
        <div class="kpi-label">Task</div>
        <div id="task" class="kpi-value" style="font-size:1.1rem;">-</div>
        <div id="phaseMeta" class="kpi-meta"></div>
      </article>
      <article class="kpi">
        <div class="kpi-label">Iteration</div>
        <div id="iteration" class="kpi-value">0</div>
        <div id="iterationMeta" class="kpi-meta"></div>
      </article>
      <article class="kpi">
        <div class="kpi-label">Prompt Queue</div>
        <div id="injectionCount" class="kpi-value">0</div>
        <div id="queueMeta" class="kpi-meta"></div>
      </article>
    </section>

    <section class="grid">
      <article class="card span-7">
        <div class="card-header">
          <h2>❓ Questions &amp; Answers</h2>
          <span id="pendingCount" class="pill accent">0 pending</span>
        </div>
        <div class="card-body" id="qaSection">
          <div class="chat-list" id="qaList"></div>
        </div>
      </article>

      <article class="card span-5">
        <div class="card-header">
          <h2>💉 Prompt Injection Queue</h2>
          <span class="pill muted">one-shot</span>
        </div>
        <div class="card-body no-pad" id="injectionQueue"></div>

        <div class="card-header" style="border-top:1px solid var(--line);">
          <h2>📝 Manual Note</h2>
          <span class="pill muted">next turn</span>
        </div>
        <div class="card-body">
          <form class="note-form" onsubmit="submitNote(event)">
            <textarea id="noteText" rows="3" placeholder="次ターンの prompt に一度だけ差し込むメモ…"></textarea>
            <button type="submit" class="primary" style="align-self:flex-end;">Add Note</button>
          </form>
        </div>
      </article>

      <article class="card span-5">
        <div class="card-header">
          <h2>⛔ Blockers</h2>
          <span id="blockerCount" class="pill danger">0</span>
        </div>
        <div class="card-body" id="blockers"></div>
      </article>

      <article class="card span-7">
        <div class="card-header">
          <h2>📋 Recent Events</h2>
          <span class="pill muted">live tail</span>
        </div>
        <div class="card-body no-pad" style="max-height:340px;overflow-y:auto;">
          <div class="event-list" id="eventsLog"></div>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header">
          <h2>🖥 Agent Output</h2>
          <span class="pill muted">latest log</span>
        </div>
        <div class="card-body no-pad">
          <pre id="agentLog">(loading)</pre>
        </div>
      </article>
    </section>
  </main>

  <script>
    function escapeHtml(value) {
      return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function formatTime(iso) {
      if (!iso) return '-';
      try {
        const d = new Date(iso);
        return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch { return iso; }
    }

    function levelIcon(level) {
      if (level === 'error')   return '●';
      if (level === 'warning') return '▲';
      return '•';
    }

    function lifecycleClass(lifecycle) {
      const map = {
        idle: 'status-idle', starting: 'status-starting', running: 'status-running',
        paused: 'status-paused', completed: 'status-completed',
        failed: 'status-failed', aborted: 'status-aborted',
      };
      return map[lifecycle] || '';
    }

    function dotClass(lifecycle) {
      if (lifecycle === 'running' || lifecycle === 'starting') return 'running';
      if (lifecycle === 'paused') return 'paused';
      if (lifecycle === 'failed' || lifecycle === 'aborted') return 'failed';
      return '';
    }

    async function postAction(path, payload = {}) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        alert(await response.text());
        return;
      }
      await refreshDashboard();
    }

    async function submitNote(event) {
      event.preventDefault();
      const el = document.getElementById('noteText');
      const note = el.value.trim();
      if (!note) return;
      await postAction('/api/note', { note });
      el.value = '';
    }

    async function submitAnswer(questionId) {
      const input = document.getElementById('answer-' + questionId);
      const answer = input.value.trim();
      if (!answer) return;
      await postAction('/api/answer', { questionId, answer });
      input.value = '';
    }

    function renderQA(pending, answered) {
      const el = document.getElementById('qaList');
      document.getElementById('pendingCount').textContent = pending.length + ' pending';

      if (pending.length === 0 && answered.length === 0) {
        el.innerHTML = '<div class="empty">質問はまだありません</div>';
        return;
      }

      let html = '';

      for (const q of pending) {
        html += \`
          <div class="chat-bubble question">
            <div class="chat-id">\${escapeHtml(q.id)} — pending</div>
            <div class="chat-text">\${escapeHtml(q.text)}</div>
            <div class="chat-meta">\${formatTime(q.createdAt)}</div>
            <form class="answer-form" onsubmit="event.preventDefault(); submitAnswer('\${escapeHtml(q.id)}');">
              <textarea id="answer-\${escapeHtml(q.id)}" rows="2" placeholder="回答を入力…"></textarea>
              <button type="submit" class="primary">送信</button>
            </form>
          </div>\`;
      }

      for (const q of answered) {
        html += \`
          <div class="chat-bubble question">
            <div class="chat-id">\${escapeHtml(q.id)} — answered</div>
            <div class="chat-text">\${escapeHtml(q.text)}</div>
            <div class="chat-meta">\${formatTime(q.createdAt)}</div>
          </div>
          <div class="chat-bubble answer">
            <div class="chat-id">\${escapeHtml(q.answer?.id || '')}</div>
            <div class="chat-text">\${escapeHtml(q.answer?.answer || '(missing)')}</div>
            <div class="chat-meta">\${formatTime(q.answeredAt)}</div>
          </div>\`;
      }

      el.innerHTML = html;
    }

    function renderInjectionQueue(items) {
      const el = document.getElementById('injectionQueue');
      if (items.length === 0) {
        el.innerHTML = '<div class="empty">注入待ち項目はありません</div>';
        return;
      }

      el.innerHTML = items.map((item) => \`
        <div class="inject-item">
          <span class="kind-badge \${escapeHtml(item.kind)}">\${escapeHtml(item.kind)}</span>
          <span style="font-family:var(--mono);font-size:0.75rem;color:var(--ink-muted);">\${escapeHtml(item.label)}</span>
          <div class="inject-text">\${escapeHtml(item.text)}</div>
        </div>
      \`).join('');
    }

    function renderBlockers(items) {
      const el = document.getElementById('blockers');
      document.getElementById('blockerCount').textContent = String(items.length);
      if (items.length === 0) {
        el.innerHTML = '<div class="empty">blocker はありません</div>';
        return;
      }

      el.innerHTML = items.map((item) => \`
        <div class="blocker-item">
          <div class="blocker-id">\${escapeHtml(item.id)} / \${formatTime(item.createdAt)}</div>
          <div>\${escapeHtml(item.text)}</div>
        </div>
      \`).join('');
    }

    function renderEvents(events) {
      const el = document.getElementById('eventsLog');
      if (events.length === 0) {
        el.innerHTML = '<div class="empty" style="padding:18px;">イベントはまだありません</div>';
        return;
      }

      el.innerHTML = events.map((ev) => \`
        <div class="event-row">
          <span class="ev-time">\${formatTime(ev.timestamp)}</span>
          <span class="ev-level \${escapeHtml(ev.level)}">\${levelIcon(ev.level)}</span>
          <span class="ev-type">\${escapeHtml(ev.type)}</span>
          <span class="ev-msg">\${escapeHtml(ev.message)}</span>
        </div>
      \`).join('');
    }

    async function refreshDashboard() {
      try {
        const response = await fetch('/api/dashboard');
        const data = await response.json();
        const s = data.status;

        const lifecycleEl = document.getElementById('lifecycle');
        lifecycleEl.textContent = s.lifecycle;
        lifecycleEl.className = 'kpi-value ' + lifecycleClass(s.lifecycle);

        document.getElementById('statusDot').className = 'dot ' + dotClass(s.lifecycle);
        document.getElementById('task').textContent = s.task || '-';
        document.getElementById('iteration').textContent = s.iteration + ' / ' + s.maxIterations;
        document.getElementById('injectionCount').textContent = String(s.pendingInjectionCount);

        document.getElementById('statusMeta').innerHTML =
          'control: <strong>' + escapeHtml(s.control) + '</strong><br>' +
          'updated: ' + formatTime(s.updatedAt);
        document.getElementById('phaseMeta').innerHTML =
          'phase: <strong>' + escapeHtml(s.phase) + '</strong><br>' +
          escapeHtml(s.currentStatusText || '-');
        document.getElementById('iterationMeta').textContent = 'mode: ' + s.mode;
        document.getElementById('queueMeta').innerHTML =
          'pending: ' + s.pendingQuestionCount + ' / answered: ' + s.answeredQuestionCount;

        renderQA(data.pendingQuestions, data.answeredQuestions);
        renderInjectionQueue(data.promptInjectionQueue);
        renderBlockers(data.blockers);
        renderEvents(data.recentEvents);
        document.getElementById('agentLog').textContent = data.agentLogTail.join('\\n');
      } catch (err) {
        console.error('refresh failed', err);
      }
    }

    setInterval(refreshDashboard, 4000);
    refreshDashboard();
  </script>
</body>
</html>`;
}

export function startPanelServer(
  config: AppConfig,
  actions: RunActions,
  hooks: PanelServerHooks = {},
) {
  const html = renderHtml();

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/dashboard') {
      const data = await actions.getDashboardData();
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/pause') {
      const data = await actions.pauseRun({ source: 'web' });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/resume') {
      const data = await actions.resumeRun({ source: 'web' });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/abort') {
      const data = await actions.abortRun({ source: 'web' });
      hooks.onAbort?.();
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/answer') {
      const body = await readJsonBody(request);
      if (!body.questionId || !body.answer) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('questionId and answer are required');
        return;
      }

      const data = await actions.submitAnswer(body.questionId, body.answer, { source: 'web' });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/note') {
      const body = await readJsonBody(request);
      if (!body.note) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('note is required');
        return;
      }

      await actions.enqueueManualNote(body.note, { source: 'web' });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  server.listen(config.panelPort, config.panelHost, () => {
    console.log(`panel: http://${config.panelHost}:${config.panelPort}`);
  });

  return server;
}
