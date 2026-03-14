import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { RunActions } from '../actions/run-actions.ts';
import type { AppConfig } from '../config.ts';

export interface PanelServerHooks {
  onAbort?: () => void;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ralph 管制画面</title>
  <style>
    :root {
      --bg: #08111b;
      --bg-elevated: rgba(9, 19, 31, 0.92);
      --panel: rgba(11, 24, 38, 0.82);
      --panel-strong: rgba(17, 32, 48, 0.96);
      --line: rgba(146, 176, 201, 0.18);
      --line-strong: rgba(146, 176, 201, 0.34);
      --text: #f2efe7;
      --muted: #89a0b6;
      --accent: #f2683a;
      --accent-soft: rgba(242, 104, 58, 0.18);
      --teal: #56c6bb;
      --teal-soft: rgba(86, 198, 187, 0.18);
      --gold: #f2c14e;
      --gold-soft: rgba(242, 193, 78, 0.18);
      --danger: #ff6b6b;
      --danger-soft: rgba(255, 107, 107, 0.16);
      --shadow: 0 32px 80px rgba(0, 0, 0, 0.28);
      --radius-xl: 28px;
      --radius-lg: 20px;
      --radius-md: 14px;
      --sans: "Avenir Next", "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif;
      --mono: "Iosevka Term", "IBM Plex Mono", "SF Mono", monospace;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: var(--sans);
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(242, 104, 58, 0.26), transparent 32%),
        radial-gradient(circle at top right, rgba(86, 198, 187, 0.22), transparent 28%),
        linear-gradient(180deg, #08111b 0%, #071019 38%, #0b1623 100%);
    }

    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 24px 22px 48px;
    }

    .hero {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      background:
        linear-gradient(135deg, rgba(242, 104, 58, 0.16), transparent 28%),
        linear-gradient(135deg, rgba(86, 198, 187, 0.16), transparent 52%),
        var(--bg-elevated);
      box-shadow: var(--shadow);
      padding: 28px;
      margin-bottom: 18px;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent);
      transform: translateX(-100%);
      animation: sweep 9s linear infinite;
      pointer-events: none;
    }

    @keyframes sweep {
      to { transform: translateX(100%); }
    }

    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
      gap: 18px;
      position: relative;
      z-index: 1;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--muted);
      font-size: 0.75rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .eyebrow .pulse {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--teal);
      box-shadow: 0 0 18px rgba(86, 198, 187, 0.65);
      animation: pulse 1.8s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(0.76); opacity: 0.36; }
    }

    h1 {
      margin: 18px 0 8px;
      font-size: clamp(2.3rem, 5vw, 4.8rem);
      line-height: 0.94;
      letter-spacing: -0.06em;
      max-width: 13ch;
    }

    .hero-subtitle {
      max-width: 58ch;
      color: var(--muted);
      font-size: 1rem;
      line-height: 1.65;
      margin: 0 0 18px;
    }

    .flash {
      display: none;
      margin-bottom: 14px;
      padding: 12px 14px;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.04);
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .flash.visible {
      display: block;
    }

    .flash.info {
      color: var(--text);
    }

    .flash.success {
      background: var(--teal-soft);
      border-color: rgba(86, 198, 187, 0.22);
      color: #d5fbf7;
    }

    .flash.warning {
      background: var(--gold-soft);
      border-color: rgba(242, 193, 78, 0.22);
      color: #fff0c3;
    }

    .flash.error {
      background: var(--danger-soft);
      border-color: rgba(255, 107, 107, 0.22);
      color: #ffd7d7;
    }

    .thinking-shell {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.04);
      border-radius: var(--radius-lg);
      padding: 14px 16px;
      min-height: 86px;
    }

    .thinking-label {
      color: var(--muted);
      font-size: 0.74rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    .thinking-track {
      position: relative;
      overflow: hidden;
      height: 2.2em;
      font-size: 1.12rem;
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }

    .thinking-line {
      position: absolute;
      inset: 0;
      transition: transform 420ms ease, opacity 420ms ease;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .thinking-line.next {
      transform: translateY(110%);
      opacity: 0;
      color: #ffd8c6;
    }

    .thinking-track.swap .thinking-line.current {
      transform: translateY(-110%);
      opacity: 0;
    }

    .thinking-track.swap .thinking-line.next {
      transform: translateY(0);
      opacity: 1;
    }

    .hero-actions {
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .hero-panel {
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--panel);
      padding: 18px;
      backdrop-filter: blur(14px);
    }

    .hero-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .meta-box {
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 14px;
    }

    .meta-label {
      color: var(--muted);
      font-size: 0.72rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 7px;
    }

    .meta-value {
      font-size: 1.22rem;
      font-weight: 700;
      letter-spacing: -0.03em;
    }

    .control-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }

    button {
      border: 0;
      border-radius: 999px;
      padding: 11px 18px;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      transition: transform 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }

    button:hover {
      transform: translateY(-1px);
    }

    .btn-primary {
      color: #fff6f0;
      background: linear-gradient(135deg, #f2683a, #e94f37);
      box-shadow: 0 12px 24px rgba(242, 104, 58, 0.22);
    }

    .btn-secondary {
      color: var(--text);
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.08);
    }

    .btn-warn {
      color: #ffe8a0;
      background: var(--gold-soft);
      border: 1px solid rgba(242, 193, 78, 0.22);
    }

    .btn-danger {
      color: #ffd4d4;
      background: var(--danger-soft);
      border: 1px solid rgba(255, 107, 107, 0.22);
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }

    .stat-card, .card {
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(14px);
      box-shadow: var(--shadow);
    }

    .stat-card {
      padding: 18px;
    }

    .stat-label {
      color: var(--muted);
      font-size: 0.72rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 1.9rem;
      font-weight: 800;
      letter-spacing: -0.05em;
      margin-bottom: 8px;
    }

    .stat-meta {
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .board {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 14px;
    }

    .card {
      overflow: hidden;
    }

    .span-7 { grid-column: span 7; }
    .span-5 { grid-column: span 5; }
    .span-12 { grid-column: span 12; }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--line);
    }

    .card-title {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .card-subtitle {
      color: var(--muted);
      font-size: 0.82rem;
    }

    .card-body {
      padding: 18px 20px 20px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 5px 10px;
      background: rgba(255,255,255,0.06);
      color: var(--muted);
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .lane-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }

    .lane-card {
      position: relative;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)),
        var(--panel-strong);
      padding: 16px;
      overflow: hidden;
    }

    .lane-card::before {
      content: "";
      position: absolute;
      inset: auto -18% -60% auto;
      width: 140px;
      height: 140px;
      border-radius: 999px;
      background: rgba(255,255,255,0.05);
      filter: blur(10px);
    }

    .lane-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .lane-name {
      font-size: 1rem;
      font-weight: 700;
    }

    .lane-role {
      color: var(--muted);
      font-size: 0.76rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .lane-state {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
      color: var(--muted);
    }

    .lane-state .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--muted);
      box-shadow: 0 0 0 transparent;
    }

    .lane-state.thinking .dot { background: var(--teal); box-shadow: 0 0 16px rgba(86, 198, 187, 0.6); }
    .lane-state.waiting .dot { background: var(--gold); box-shadow: 0 0 16px rgba(242, 193, 78, 0.45); }
    .lane-state.blocked .dot { background: var(--danger); box-shadow: 0 0 16px rgba(255, 107, 107, 0.45); }
    .lane-state.done .dot { background: var(--accent); box-shadow: 0 0 16px rgba(242, 104, 58, 0.38); }

    .lane-focus {
      font-size: 0.92rem;
      line-height: 1.6;
      min-height: 3.2em;
      margin-bottom: 12px;
    }

    .lane-bar {
      height: 7px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      overflow: hidden;
      margin-bottom: 10px;
    }

    .lane-bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--teal), var(--accent));
    }

    .lane-tasks {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .lane-task {
      padding: 5px 8px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: var(--muted);
      font-size: 0.75rem;
      font-family: var(--mono);
    }

    .task-list, .conversation-list, .signal-list, .event-list {
      display: grid;
      gap: 12px;
    }

    .task-item {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 14px;
      background: rgba(255,255,255,0.03);
      transition: border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
    }

    .task-item.current {
      border-color: rgba(86, 198, 187, 0.28);
      box-shadow: 0 16px 32px rgba(86, 198, 187, 0.08);
    }

    .task-item.next {
      border-color: rgba(242, 193, 78, 0.24);
      box-shadow: 0 16px 32px rgba(242, 193, 78, 0.06);
    }

    .task-item:hover {
      transform: translateY(-1px);
    }

    .task-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }

    .task-title {
      font-weight: 700;
      font-size: 0.96rem;
      margin-bottom: 4px;
    }

    .task-id {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.76rem;
    }

    .task-summary {
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.55;
    }

    .task-status, .priority-badge {
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border: 1px solid transparent;
      white-space: nowrap;
    }

    .task-status.active { background: var(--teal-soft); color: #9be8de; border-color: rgba(86, 198, 187, 0.18); }
    .task-status.queued { background: rgba(255,255,255,0.05); color: var(--muted); border-color: rgba(255,255,255,0.08); }
    .task-status.blocked { background: var(--danger-soft); color: #ffcece; border-color: rgba(255, 107, 107, 0.2); }
    .task-status.completed { background: var(--accent-soft); color: #ffd7c6; border-color: rgba(242, 104, 58, 0.2); }

    .priority-badge.critical { background: rgba(255, 107, 107, 0.12); color: #ffd0d0; }
    .priority-badge.high { background: rgba(242, 193, 78, 0.14); color: #ffe3a4; }
    .priority-badge.medium { background: rgba(86, 198, 187, 0.14); color: #b7f2ec; }
    .priority-badge.low { background: rgba(255,255,255,0.06); color: var(--muted); }

    .task-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .task-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    .conversation-item {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 14px;
      background: rgba(255,255,255,0.03);
    }

    .conversation-item.question {
      border-left: 3px solid var(--accent);
    }

    .conversation-item.answer {
      border-left: 3px solid var(--teal);
      background: rgba(86, 198, 187, 0.08);
    }

    .conversation-id, .signal-id {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.76rem;
      margin-bottom: 6px;
    }

    .conversation-text, .signal-text {
      font-size: 0.92rem;
      line-height: 1.55;
      margin-bottom: 8px;
    }

    .conversation-meta {
      color: var(--muted);
      font-size: 0.78rem;
    }

    textarea {
      width: 100%;
      min-height: 92px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-md);
      background: rgba(5, 12, 20, 0.86);
      color: var(--text);
      padding: 12px 14px;
      font: inherit;
      resize: vertical;
    }

    input, select {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-md);
      background: rgba(5, 12, 20, 0.86);
      color: var(--text);
      padding: 12px 14px;
      font: inherit;
    }

    textarea:focus {
      outline: none;
      border-color: rgba(86, 198, 187, 0.48);
      box-shadow: 0 0 0 4px rgba(86, 198, 187, 0.12);
    }

    input:focus, select:focus {
      outline: none;
      border-color: rgba(86, 198, 187, 0.48);
      box-shadow: 0 0 0 4px rgba(86, 198, 187, 0.12);
    }

    .answer-form, .note-form {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }

    .settings-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .settings-field {
      display: grid;
      gap: 8px;
    }

    .settings-field.span-3 {
      grid-column: span 3;
    }

    .settings-field label {
      color: var(--muted);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .signal-item {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 14px;
      background: rgba(255,255,255,0.03);
    }

    .signal-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      border: 1px solid rgba(255,255,255,0.08);
      color: var(--muted);
      background: rgba(255,255,255,0.04);
    }

    .event-item {
      display: grid;
      grid-template-columns: 74px minmax(0, 1fr);
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }

    .event-item:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .event-time {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.76rem;
    }

    .event-message {
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .event-type {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.72rem;
      margin-bottom: 4px;
    }

    pre {
      margin: 0;
      padding: 20px;
      max-height: 420px;
      overflow: auto;
      background: rgba(4, 10, 16, 0.92);
      color: #d7e8fb;
      font-family: var(--mono);
      font-size: 0.82rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .empty {
      color: var(--muted);
      padding: 14px 0;
      text-align: center;
      font-style: italic;
    }

    @media (max-width: 1180px) {
      .hero-grid,
      .stats {
        grid-template-columns: 1fr 1fr;
      }

      .span-7, .span-5, .span-12 {
        grid-column: span 12;
      }
    }

    @media (max-width: 760px) {
      .shell {
        padding: 16px 14px 40px;
      }

      .hero-grid,
      .stats,
      .hero-meta {
        grid-template-columns: 1fr;
      }

      .card-header {
        align-items: flex-start;
        flex-direction: column;
      }

      .control-row {
        flex-direction: column;
      }

      button {
        width: 100%;
      }

      .thinking-track {
        height: 3em;
      }

      .settings-grid {
        grid-template-columns: 1fr;
      }

      .settings-field.span-3 {
        grid-column: span 1;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="hero-grid">
        <div>
          <div class="eyebrow"><span class="pulse"></span>ralph 管制画面</div>
          <h1 id="heroTask">Ralph を起動しました</h1>
          <p class="hero-subtitle">
            単一ステータス画面ではなく、Task の進行と次に着手する Task を中心に loop を監督します。
          </p>
          <div id="flashMessage" class="flash"></div>
          <div class="thinking-shell">
            <div class="thinking-label">思考の流れ</div>
            <div id="thinkingTrack" class="thinking-track">
              <div id="thinkingCurrent" class="thinking-line current">Ralph が考えています...</div>
              <div id="thinkingNext" class="thinking-line next"></div>
            </div>
          </div>
        </div>

        <div class="hero-actions">
          <div class="hero-panel">
            <div class="hero-meta">
              <div class="meta-box">
                <div class="meta-label">状態</div>
                <div id="heroLifecycle" class="meta-value">idle</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">反復回数</div>
                <div id="heroIteration" class="meta-value">0 / 0</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">コマンド</div>
                <div id="heroCommand" class="meta-value" style="font-size:0.95rem; line-height:1.4;">-</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">更新時刻</div>
                <div id="heroUpdated" class="meta-value" style="font-size:0.95rem;">-</div>
              </div>
            </div>
            <div class="control-row">
              <button class="btn-secondary" onclick="refreshDashboard()">更新</button>
              <button class="btn-primary" onclick="startRun()">実行開始</button>
              <button class="btn-warn" onclick="postAction('/api/pause')">一時停止</button>
              <button class="btn-secondary" onclick="postAction('/api/resume')">再開</button>
              <button class="btn-danger" onclick="postAction('/api/abort')">中断</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="stats">
      <article class="stat-card">
        <div class="stat-label">統合上限</div>
        <div id="statIntegration" class="stat-value">1</div>
        <div id="statIntegrationMeta" class="stat-meta">Task量から自動決定します。</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">Task 数</div>
        <div id="statTasks" class="stat-value">0</div>
        <div id="statTasksMeta" class="stat-meta">Task はまだありません。</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">確認待ち</div>
        <div id="statQuestions" class="stat-value">0</div>
        <div id="statQuestionsMeta" class="stat-meta">確認待ちはありません。</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">差し込み待ち</div>
        <div id="statQueue" class="stat-value">0</div>
        <div id="statQueueMeta" class="stat-meta">次ターンに反映する情報です。</div>
      </article>
    </section>

    <section class="board">
      <article class="card span-12">
        <div class="card-header">
          <div>
            <div class="card-title">実行設定</div>
            <div class="card-subtitle">サイトから Task / prompt / 思考回数を更新し、そのまま実行を始められます。</div>
          </div>
          <span id="settingsMeta" class="pill">実行設定</span>
        </div>
        <div class="card-body">
          <form id="settingsForm" class="settings-grid" onsubmit="saveSettings(event)">
            <div class="settings-field">
              <label for="settingsTaskName">Task</label>
              <input id="settingsTaskName" placeholder="今回の実行名" />
            </div>
            <div class="settings-field">
              <label for="settingsMaxIterations">思考回数</label>
              <input id="settingsMaxIterations" type="number" min="1" step="1" />
            </div>
            <div class="settings-field">
              <label for="settingsIdleSeconds">待機秒数</label>
              <input id="settingsIdleSeconds" type="number" min="1" step="1" />
            </div>
            <div class="settings-field">
              <label for="settingsMode">実行方式</label>
              <select id="settingsMode">
                <option value="command">通常実行</option>
                <option value="demo">デモ</option>
              </select>
            </div>
            <div class="settings-field span-3">
              <label for="settingsAgentCommand">エージェントコマンド</label>
              <input id="settingsAgentCommand" placeholder="codex exec --full-auto --skip-git-repo-check" />
            </div>
            <div class="settings-field span-3">
              <label for="settingsPromptFile">Prompt ファイル</label>
              <input id="settingsPromptFile" placeholder="/abs/path/to/prompt.md" />
            </div>
            <div class="settings-field span-3">
              <label for="settingsPromptBody">Prompt 上書き</label>
              <textarea id="settingsPromptBody" rows="8" placeholder="ここに直接 prompt を書くと file より優先します"></textarea>
            </div>
            <div class="settings-field span-3">
              <button type="submit" class="btn-primary">設定を保存</button>
            </div>
          </form>
        </div>
      </article>

      <article class="card span-7">
        <div class="card-header">
          <div>
            <div class="card-title">エージェント状況</div>
            <div class="card-subtitle">監督、計画、実行、統合の役割を同じ画面で可視化します。</div>
          </div>
          <span id="laneMeta" class="pill">0 レーン</span>
        </div>
        <div class="card-body">
          <div id="agentLanes" class="lane-grid"></div>
        </div>
      </article>

      <article class="card span-5">
        <div class="card-header">
          <div>
            <div class="card-title">Task 一覧</div>
            <div class="card-subtitle">Task の作成、編集、完了チェックをここで行います。</div>
          </div>
          <span id="taskMeta" class="pill">0 tasks</span>
        </div>
        <div class="card-body">
          <form class="note-form" onsubmit="submitTask(event)" style="margin-bottom:16px;">
            <input id="taskEditorId" type="hidden" />
            <input id="taskTitle" placeholder="最初のTask、または追加したいTask名" />
            <textarea id="taskSummary" rows="3" placeholder="Taskの説明や完了条件"></textarea>
            <div class="control-row" style="margin-top:0;">
              <button type="submit" class="btn-primary">Taskを保存</button>
              <button type="button" class="btn-secondary" onclick="resetTaskEditor()">編集をやめる</button>
            </div>
          </form>
          <div id="taskFlow" class="conversation-list" style="margin-bottom:16px;"></div>
          <div id="taskBoard" class="task-list"></div>
        </div>
      </article>

      <article class="card span-7">
        <div class="card-header">
          <div>
            <div class="card-title">質問と回答</div>
            <div class="card-subtitle">回答待ちでも止めずに進め、届いたら次ターンに反映します。</div>
          </div>
          <span id="questionMeta" class="pill">0 件</span>
        </div>
        <div class="card-body">
          <div id="conversationList" class="conversation-list"></div>
          <form class="note-form" onsubmit="submitNote(event)">
            <textarea id="noteText" rows="3" placeholder="次ターンに差し込みたいメモや方針を書きます"></textarea>
            <button type="submit" class="btn-primary">メモを追加</button>
          </form>
        </div>
      </article>

      <article class="card span-5">
        <div class="card-header">
          <div>
            <div class="card-title">通知とログ</div>
            <div class="card-subtitle">Blocker / 差し込み / イベントをひとつの流れで見ます。</div>
          </div>
          <span id="signalMeta" class="pill">監視中</span>
        </div>
        <div class="card-body">
          <div id="signalList" class="signal-list"></div>
          <div id="eventList" class="event-list" style="margin-top:18px;"></div>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header">
          <div>
            <div class="card-title">エージェント出力</div>
            <div class="card-subtitle">デバッグや確認のために生の出力も残します。</div>
          </div>
          <span class="pill">出力ログ</span>
        </div>
        <pre id="agentLog">読み込み中...</pre>
      </article>
    </section>
  </div>

  <script>
    let thinkingFrames = ['Ralph が考えています...'];
    let thinkingIndex = 0;
    let thinkingSwapTimer = null;
    let flashTimer = null;
    let settingsDirty = false;
    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function formatTime(iso) {
      if (!iso) return '-';
      try {
        const date = new Date(iso);
        return date.toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      } catch {
        return iso;
      }
    }

    function lifecycleLabel(value) {
      if (value === 'starting') return '開始中';
      if (value === 'running') return '実行中';
      if (value === 'paused') return '一時停止';
      if (value === 'pause_requested') return '停止待ち';
      if (value === 'completed') return '完了';
      if (value === 'aborted') return '中断';
      if (value === 'failed') return '失敗';
      return '待機';
    }

    function sourceLabel(value) {
      if (value === 'web') return 'サイト';
      if (value === 'discord') return 'Discord';
      if (value === 'cli') return 'CLI';
      if (value === 'agent') return 'エージェント';
      if (value === 'file') return 'ファイル';
      if (value === 'system') return 'システム';
      return value || 'システム';
    }

    function setThinkingFrames(frames) {
      const nextFrames = (frames || []).filter(Boolean);
      const normalized = nextFrames.length > 0 ? nextFrames : ['Ralph が考えています...'];
      if (JSON.stringify(normalized) === JSON.stringify(thinkingFrames)) {
        return;
      }

      thinkingFrames = normalized;
      thinkingIndex = 0;
      document.getElementById('thinkingCurrent').textContent = thinkingFrames[0];
      document.getElementById('thinkingNext').textContent =
        thinkingFrames[(thinkingIndex + 1) % thinkingFrames.length] || '';
    }

    function cycleThinkingFrame() {
      if (thinkingFrames.length <= 1) {
        return;
      }

      const track = document.getElementById('thinkingTrack');
      const current = document.getElementById('thinkingCurrent');
      const next = document.getElementById('thinkingNext');
      const nextIndex = (thinkingIndex + 1) % thinkingFrames.length;
      next.textContent = thinkingFrames[nextIndex];
      track.classList.add('swap');

      window.clearTimeout(thinkingSwapTimer);
      thinkingSwapTimer = window.setTimeout(() => {
        thinkingIndex = nextIndex;
        current.textContent = thinkingFrames[thinkingIndex];
        next.textContent = thinkingFrames[(thinkingIndex + 1) % thinkingFrames.length] || '';
        track.classList.remove('swap');
      }, 430);
    }

    async function postAction(path, payload = {}) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await response.text();
        showFlash(message || '操作に失敗しました', 'error');
        return null;
      }

      const data = await response.json().catch(() => ({}));
      await refreshDashboard();
      return data;
    }

    function showFlash(message, tone = 'info') {
      const el = document.getElementById('flashMessage');
      if (!message) {
        el.textContent = '';
        el.className = 'flash';
        return;
      }

      el.textContent = message;
      el.className = 'flash visible ' + tone;
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        el.className = 'flash';
      }, 5000);
    }

    async function startRun() {
      const result = await postAction('/api/start');
      if (!result) {
        return;
      }
      showFlash(result?.message || '実行を要求しました', result?.started ? 'success' : 'warning');
    }

    async function saveSettings(event) {
      event.preventDefault();
      const result = await postAction('/api/settings', {
        taskName: document.getElementById('settingsTaskName').value.trim(),
        maxIterations: Number.parseInt(document.getElementById('settingsMaxIterations').value, 10),
        idleSeconds: Number.parseInt(document.getElementById('settingsIdleSeconds').value, 10),
        mode: document.getElementById('settingsMode').value,
        agentCommand: document.getElementById('settingsAgentCommand').value.trim(),
        promptFile: document.getElementById('settingsPromptFile').value.trim(),
        promptBody: document.getElementById('settingsPromptBody').value,
      });
      if (!result) {
        return;
      }
      settingsDirty = false;
      showFlash('実行設定を保存しました', 'success');
    }

    async function submitAnswer(questionId) {
      const el = document.getElementById('answer-' + questionId);
      const answer = el.value.trim();
      if (!answer) return;
      const result = await postAction('/api/answer', { questionId, answer });
      if (!result) {
        return;
      }
      el.value = '';
      showFlash('回答を保存しました', 'success');
    }

    async function submitNote(event) {
      event.preventDefault();
      const el = document.getElementById('noteText');
      const note = el.value.trim();
      if (!note) return;
      const result = await postAction('/api/note', { note });
      if (!result) {
        return;
      }
      el.value = '';
      showFlash('メモを追加しました', 'success');
    }

    function resetTaskEditor() {
      document.getElementById('taskEditorId').value = '';
      document.getElementById('taskTitle').value = '';
      document.getElementById('taskSummary').value = '';
    }

    function beginTaskEdit(taskId, title, summary) {
      document.getElementById('taskEditorId').value = taskId;
      document.getElementById('taskTitle').value = title;
      document.getElementById('taskSummary').value = summary || '';
      showFlash(taskId + ' を編集中です', 'info');
    }

    async function submitTask(event) {
      event.preventDefault();
      const taskId = document.getElementById('taskEditorId').value.trim();
      const title = document.getElementById('taskTitle').value.trim();
      const summary = document.getElementById('taskSummary').value.trim();
      if (!title) {
        showFlash('Task名を入力してください', 'warning');
        return;
      }

      if (taskId) {
        const result = await postAction('/api/task/update', { taskId, title, summary });
        if (!result) {
          return;
        }
        showFlash(taskId + ' を更新しました', 'success');
      } else {
        const result = await postAction('/api/task/create', { title, summary });
        if (!result) {
          return;
        }
        showFlash('Task を追加しました', 'success');
      }

      resetTaskEditor();
    }

    async function completeTask(taskId) {
      const result = await postAction('/api/task/complete', { taskId });
      if (!result) {
        return;
      }
      showFlash(taskId + ' に完了チェックを付けました', 'success');
    }

    async function reopenTask(taskId) {
      const result = await postAction('/api/task/reopen', { taskId });
      if (!result) {
        return;
      }
      showFlash(taskId + ' を未完了に戻しました', 'warning');
    }

    function renderAgentLanes(items) {
      const el = document.getElementById('agentLanes');
      document.getElementById('laneMeta').textContent = items.length + ' レーン';

      if (items.length === 0) {
        el.innerHTML = '<div class="empty">エージェントレーンはまだありません</div>';
        return;
      }

      el.innerHTML = items.map((item) => {
        const fill = Math.max(8, Math.min(100, item.capacity > 0 ? (item.load / item.capacity) * 100 : 0));
        const roleLabel =
          item.role === 'supervisor' ? '監督'
          : item.role === 'planner' ? '計画'
          : item.role === 'integrator' ? '統合'
          : '実行';
        const stateLabel =
          item.status === 'thinking' ? '思考中'
          : item.status === 'waiting' ? '待機中'
          : item.status === 'blocked' ? '停止中'
          : item.status === 'done' ? '完了'
          : '待機';
        return \`
          <article class="lane-card">
            <div class="lane-head">
              <div>
                <div class="lane-name">\${escapeHtml(item.name)}</div>
                <div class="lane-role">\${escapeHtml(roleLabel)}</div>
              </div>
              <div class="lane-state \${escapeHtml(item.status)}">
                <span class="dot"></span>
                <span>\${escapeHtml(stateLabel)}</span>
              </div>
            </div>
            <div class="lane-focus">\${escapeHtml(item.focus)}</div>
            <div class="lane-bar"><span style="width:\${fill}%"></span></div>
            <div class="lane-state">\${escapeHtml(item.load)} / \${escapeHtml(item.capacity)} 稼働</div>
            <div class="lane-tasks">
              \${item.taskIds.length > 0
                ? item.taskIds.map((taskId) => '<span class="lane-task">' + escapeHtml(taskId) + '</span>').join('')
                : '<span class="lane-task">待機中</span>'}
            </div>
          </article>
        \`;
      }).join('');
    }

    function renderTaskFlow(currentTask, nextTask) {
      const el = document.getElementById('taskFlow');
      const cards = [];

      if (currentTask) {
        cards.push(\`
          <article class="conversation-item question">
            <div class="conversation-id">現在のTask / \${escapeHtml(currentTask.id)}</div>
            <div class="conversation-text">\${escapeHtml(currentTask.title)}</div>
            <div class="conversation-meta">\${escapeHtml(currentTask.summary || currentTask.title)}</div>
          </article>
        \`);
      }

      if (nextTask) {
        cards.push(\`
          <article class="conversation-item answer">
            <div class="conversation-id">次のTask / \${escapeHtml(nextTask.id)}</div>
            <div class="conversation-text">\${escapeHtml(nextTask.title)}</div>
            <div class="conversation-meta">\${escapeHtml(nextTask.summary || nextTask.title)}</div>
          </article>
        \`);
      }

      el.innerHTML = cards.length > 0
        ? cards.join('')
        : '<div class="empty">まだTaskがありません。最初のTaskを作成してください。</div>';
    }

    function renderTaskBoard(items, currentTask, nextTask) {
      const el = document.getElementById('taskBoard');
      document.getElementById('taskMeta').textContent = items.length + ' 件';

      if (items.length === 0) {
        el.innerHTML = '<div class="empty">Task はまだありません</div>';
        return;
      }

      el.innerHTML = items.map((item) => \`
        <article class="task-item \${currentTask && currentTask.id === item.id ? 'current' : nextTask && nextTask.id === item.id ? 'next' : ''}">
          <div class="task-row">
            <div>
              <div class="task-id">\${escapeHtml(item.id)}</div>
              <div class="task-title">\${escapeHtml(item.title)}</div>
            </div>
            <div class="task-status \${escapeHtml(item.displayStatus)}">\${escapeHtml(item.displayStatus === 'active' ? '現在' : item.displayStatus === 'queued' ? '待機' : item.displayStatus === 'completed' ? '完了' : '停止')}</div>
          </div>
          <div class="task-summary">\${escapeHtml(item.summary || item.title)}</div>
          <div class="task-meta">
            <span class="priority-badge \${escapeHtml(item.priority)}">\${escapeHtml(item.priority === 'critical' ? '最重要' : item.priority === 'high' ? '高' : item.priority === 'medium' ? '中' : '低')}</span>
            <span class="tag">作成元: \${escapeHtml(item.source)}</span>
            \${currentTask && currentTask.id === item.id ? '<span class="tag">今やるTask</span>' : ''}
            \${nextTask && nextTask.id === item.id ? '<span class="tag">次にやるTask</span>' : ''}
            \${item.acceptanceCriteria && item.acceptanceCriteria.length > 0
              ? '<span class="tag">条件 ' + escapeHtml(item.acceptanceCriteria.length) + ' 件</span>'
              : ''}
          </div>
          <div class="task-actions">
            <button
              type="button"
              class="btn-secondary task-edit-button"
              data-task-id="\${escapeHtml(item.id)}"
              data-task-title="\${escapeHtml(item.title)}"
              data-task-summary="\${escapeHtml(item.summary || '')}"
            >編集</button>
            \${item.displayStatus === 'completed'
              ? '<button type="button" class="btn-warn task-reopen-button" data-task-id="' + escapeHtml(item.id) + '">未完了に戻す</button>'
              : '<button type="button" class="btn-primary task-complete-button" data-task-id="' + escapeHtml(item.id) + '">完了チェック</button>'}
          </div>
        </article>
      \`).join('');
    }

    function renderConversation(pending, answered) {
      const el = document.getElementById('conversationList');
      document.getElementById('questionMeta').textContent = pending.length + ' 件待ち';

      if (pending.length === 0 && answered.length === 0) {
        el.innerHTML = '<div class="empty">質問はまだありません</div>';
        return;
      }

      const pendingHtml = pending.map((item) => \`
        <article class="conversation-item question">
          <div class="conversation-id">\${escapeHtml(item.id)} / 回答待ち</div>
          <div class="conversation-text">\${escapeHtml(item.text)}</div>
          <div class="conversation-meta">\${formatTime(item.createdAt)}</div>
          <form class="answer-form" onsubmit="event.preventDefault(); submitAnswer('\${escapeHtml(item.id)}');">
            <textarea id="answer-\${escapeHtml(item.id)}" rows="2" placeholder="回答を入力"></textarea>
            <button type="submit" class="btn-primary">回答する</button>
          </form>
        </article>
      \`).join('');

      const answeredHtml = answered.map((item) => \`
        <article class="conversation-item question">
          <div class="conversation-id">\${escapeHtml(item.id)} / 回答済み</div>
          <div class="conversation-text">\${escapeHtml(item.text)}</div>
          <div class="conversation-meta">\${formatTime(item.createdAt)}</div>
        </article>
        <article class="conversation-item answer">
          <div class="conversation-id">\${escapeHtml(item.answer?.id || '')}</div>
          <div class="conversation-text">\${escapeHtml(item.answer?.answer || '(回答データなし)')}</div>
          <div class="conversation-meta">\${formatTime(item.answeredAt)}</div>
        </article>
      \`).join('');

      el.innerHTML = pendingHtml + answeredHtml;
    }

    function renderSignals(queue, blockers, events) {
      const signalEl = document.getElementById('signalList');
      const eventEl = document.getElementById('eventList');
      document.getElementById('signalMeta').textContent =
        blockers.length + ' 件の要対応 / ' + queue.length + ' 件の差し込み待ち';

      const signalParts = [];

      if (queue.length > 0) {
        signalParts.push(...queue.map((item) => \`
          <article class="signal-item">
            <div class="signal-id">\${escapeHtml(item.id)} / \${escapeHtml(item.kind === 'answer' ? '回答' : 'メモ')}</div>
            <div class="signal-text">\${escapeHtml(item.text)}</div>
            <div class="signal-tags">
              <span class="tag">対象: \${escapeHtml(item.label)}</span>
              <span class="tag">時刻: \${formatTime(item.createdAt)}</span>
            </div>
          </article>
        \`));
      }

      if (blockers.length > 0) {
        signalParts.push(...blockers.map((item) => \`
          <article class="signal-item" style="border-color:rgba(255,107,107,0.22);background:rgba(255,107,107,0.08);">
            <div class="signal-id">\${escapeHtml(item.id)} / 要対応</div>
            <div class="signal-text">\${escapeHtml(item.text)}</div>
            <div class="signal-tags">
              <span class="tag">作成元: \${escapeHtml(item.source)}</span>
              <span class="tag">時刻: \${formatTime(item.createdAt)}</span>
            </div>
          </article>
        \`));
      }

      signalEl.innerHTML = signalParts.length > 0
        ? signalParts.join('')
        : '<div class="empty">通知はまだありません</div>';

      eventEl.innerHTML = events.length > 0
        ? events.map((item) => \`
            <div class="event-item">
              <div class="event-time">\${formatTime(item.timestamp)}</div>
              <div>
                <div class="event-type">\${escapeHtml(item.type)} / \${escapeHtml(item.level === 'warning' ? '注意' : item.level === 'error' ? '異常' : '情報')}</div>
                <div class="event-message">\${escapeHtml(item.message)}</div>
              </div>
            </div>
          \`).join('')
        : '<div class="empty">イベントはまだありません</div>';
    }

    function renderSettings(settings) {
      document.getElementById('settingsMeta').textContent =
        '更新者: ' + sourceLabel(settings.updatedBy);

      if (settingsDirty) {
        return;
      }

      document.getElementById('settingsTaskName').value = settings.taskName || '';
      document.getElementById('settingsMaxIterations').value = String(settings.maxIterations || 1);
      document.getElementById('settingsIdleSeconds').value = String(settings.idleSeconds || 1);
      document.getElementById('settingsMode').value = settings.mode || 'command';
      document.getElementById('settingsAgentCommand').value = settings.agentCommand || '';
      document.getElementById('settingsPromptFile').value = settings.promptFile || '';
      document.getElementById('settingsPromptBody').value = settings.promptBody || '';
    }

    async function refreshDashboard() {
      const response = await fetch('/api/dashboard');
      const data = await response.json();
      const status = data.status;

      document.getElementById('heroTask').textContent = status.task || 'Ralph';
      document.getElementById('heroLifecycle').textContent = lifecycleLabel(status.lifecycle);
      document.getElementById('heroIteration').textContent = status.iteration + ' / ' + status.maxIterations;
      document.getElementById('heroCommand').textContent = status.agentCommand || '-';
      document.getElementById('heroUpdated').textContent = formatTime(status.updatedAt);

      document.getElementById('statIntegration').textContent = String(status.maxIntegration);
      document.getElementById('statIntegrationMeta').textContent =
        status.totalTaskCount + ' 件のTaskから自動計算';
      document.getElementById('statTasks').textContent = String(status.totalTaskCount);
      document.getElementById('statTasksMeta').textContent =
        status.activeTaskCount + ' 件進行中 / ' + status.queuedTaskCount + ' 件待機 / ' + status.completedTaskCount + ' 件完了';
      document.getElementById('statQuestions').textContent = String(status.pendingQuestionCount);
      document.getElementById('statQuestionsMeta').textContent =
        status.answeredQuestionCount + ' 件回答済み / ' + status.blockerCount + ' 件の要対応';
      document.getElementById('statQueue').textContent = String(status.pendingInjectionCount);
      document.getElementById('statQueueMeta').textContent =
        '状態: ' + (
          status.phase === 'queued' ? '実行予約'
          : status.phase === 'starting' ? '開始中'
          : status.phase === 'running' ? '実行中'
          : status.phase === 'paused' ? '一時停止'
          : status.phase === 'completed' ? '完了'
          : status.phase === 'aborted' ? '中断'
          : status.phase === 'failed' ? '失敗'
          : status.phase === 'interrupted' ? '中断復帰'
          : status.phase === 'max_iterations_reached' ? '思考回数上限'
          : '待機中'
        ) + ' / 実行: ' + (status.mode === 'demo' ? 'デモ' : '通常実行');

      setThinkingFrames(data.thinkingFrames || [status.thinkingText || status.currentStatusText || 'Ralph が考えています...']);
      renderSettings(data.settings);
      renderAgentLanes(data.agentLanes || []);
      renderTaskFlow(data.currentTask, data.nextTask);
      renderTaskBoard(data.taskBoard || [], data.currentTask, data.nextTask);
      renderConversation(data.pendingQuestions || [], data.answeredQuestions || []);
      renderSignals(data.promptInjectionQueue || [], data.blockers || [], data.recentEvents || []);
      document.getElementById('agentLog').textContent = (data.agentLogTail || []).join('\\n');
    }

    window.setInterval(cycleThinkingFrame, 2200);
    window.setInterval(() => {
      refreshDashboard().catch((error) => console.error(error));
    }, 4000);

    refreshDashboard().catch((error) => console.error(error));

    document.querySelectorAll('#settingsForm input, #settingsForm textarea, #settingsForm select').forEach((element) => {
      element.addEventListener('input', () => {
        settingsDirty = true;
      });
      element.addEventListener('change', () => {
        settingsDirty = true;
      });
    });

    document.getElementById('taskBoard').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const editButton = target.closest('.task-edit-button');
      if (editButton instanceof HTMLElement) {
        beginTaskEdit(
          editButton.dataset.taskId || '',
          editButton.dataset.taskTitle || '',
          editButton.dataset.taskSummary || '',
        );
        return;
      }

      const completeButton = target.closest('.task-complete-button');
      if (completeButton instanceof HTMLElement && completeButton.dataset.taskId) {
        void completeTask(completeButton.dataset.taskId);
        return;
      }

      const reopenButton = target.closest('.task-reopen-button');
      if (reopenButton instanceof HTMLElement && reopenButton.dataset.taskId) {
        void reopenTask(reopenButton.dataset.taskId);
      }
    });
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

    if (request.method === 'POST' && url.pathname === '/api/start') {
      const data = await actions.requestRunStart({ source: 'web' });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/settings') {
      const body = await readJsonBody(request);
      const data = await actions.updateRuntimeSettings(
        {
          taskName: typeof body.taskName === 'string' ? body.taskName : undefined,
          agentCommand: typeof body.agentCommand === 'string' ? body.agentCommand : undefined,
          promptFile: typeof body.promptFile === 'string' ? body.promptFile : undefined,
          promptBody: typeof body.promptBody === 'string' ? body.promptBody : undefined,
          maxIterations:
            body.maxIterations !== undefined ? Number.parseInt(String(body.maxIterations), 10) : undefined,
          idleSeconds:
            body.idleSeconds !== undefined ? Number.parseInt(String(body.idleSeconds), 10) : undefined,
          mode:
            body.mode === 'demo'
              ? 'demo'
              : body.mode === 'command'
                ? 'command'
                : undefined,
        },
        { source: 'web' },
      );
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
      if (typeof body.questionId !== 'string' || typeof body.answer !== 'string' || !body.questionId || !body.answer) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('質問IDと回答の両方が必要です');
        return;
      }

      const data = await actions.submitAnswer(body.questionId, body.answer, { source: 'web' });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/note') {
      const body = await readJsonBody(request);
      if (typeof body.note !== 'string' || !body.note) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('メモを入力してください');
        return;
      }

      await actions.enqueueManualNote(body.note, { source: 'web' });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/task/create') {
      try {
        const body = await readJsonBody(request);
        const data = await actions.createTask(
          {
            title: typeof body.title === 'string' ? body.title : undefined,
            summary: typeof body.summary === 'string' ? body.summary : undefined,
          },
          { source: 'web' },
        );
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(data));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'Task を作成できませんでした');
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/task/update') {
      const body = await readJsonBody(request);
      if (typeof body.taskId !== 'string' || !body.taskId) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('更新対象のTask IDが必要です');
        return;
      }

      const data = await actions.updateTask(
        body.taskId,
        {
          title: typeof body.title === 'string' ? body.title : undefined,
          summary: typeof body.summary === 'string' ? body.summary : undefined,
        },
        { source: 'web' },
      );

      if (!data) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('指定した Task が見つかりません');
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/task/complete') {
      const body = await readJsonBody(request);
      if (typeof body.taskId !== 'string' || !body.taskId) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('完了にするTask IDが必要です');
        return;
      }

      const data = await actions.completeTask(body.taskId, { source: 'web' });
      if (!data) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('指定した Task が見つかりません');
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/task/reopen') {
      const body = await readJsonBody(request);
      if (typeof body.taskId !== 'string' || !body.taskId) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('戻すTask IDが必要です');
        return;
      }

      const data = await actions.reopenTask(body.taskId, { source: 'web' });
      if (!data) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('指定した Task が見つかりません');
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ページが見つかりません');
  });

  server.listen(config.panelPort, config.panelHost, () => {
    console.log(`panel: http://${config.panelHost}:${config.panelPort}`);
  });

  return server;
}
