import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { RunActions } from '../actions/run-actions.ts';
import type { AppConfig } from '../config.ts';

export interface PanelServerHooks {
  onAbort?: () => void;
}

const JSON_BODY_LIMIT = 1024 * 1024;

class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isPanelAuthEnabled(config: AppConfig): boolean {
  return config.panelUsername.trim().length > 0 && config.panelPassword.trim().length > 0;
}

function isAuthorized(request: IncomingMessage, config: AppConfig): boolean {
  if (!isPanelAuthEnabled(config)) {
    return true;
  }

  const header = request.headers.authorization;
  if (!header?.startsWith('Basic ')) {
    return false;
  }

  const encoded = header.slice('Basic '.length).trim();
  const actual = Buffer.from(encoded, 'base64').toString('utf8');
  return actual === `${config.panelUsername}:${config.panelPassword}`;
}

function writeUnauthorized(response: ServerResponse): void {
  writeText(response, 401, '認証が必要です', {
    'www-authenticate': 'Basic realm="Ralph Panel", charset="UTF-8"',
  });
}

function writeJson(response: ServerResponse, statusCode: number, data: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function writeText(
  response: ServerResponse,
  statusCode: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  });
  response.end(message);
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.writableEnded) {
    return;
  }

  if (error instanceof HttpError) {
    writeText(response, error.statusCode, error.message);
    return;
  }

  console.error('panel: request failed', error);
  writeText(response, 500, 'panel request failed');
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    totalSize += buffer.byteLength;
    if (totalSize > JSON_BODY_LIMIT) {
      throw new HttpError(413, 'リクエストボディが大きすぎます');
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON を読み取れませんでした');
  }
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
      --bg: #111516;
      --bg-elevated: #171c1e;
      --panel: #1b2124;
      --panel-strong: #161b1d;
      --line: rgba(240, 232, 220, 0.08);
      --line-strong: rgba(240, 232, 220, 0.16);
      --text: #f3ede3;
      --muted: #98a3a5;
      --accent: #c96f41;
      --accent-soft: rgba(201, 111, 65, 0.14);
      --teal: #4f9b8c;
      --teal-soft: rgba(79, 155, 140, 0.16);
      --gold: #b78f3f;
      --gold-soft: rgba(183, 143, 63, 0.16);
      --danger: #c15d5d;
      --danger-soft: rgba(193, 93, 93, 0.16);
      --shadow: 0 14px 36px rgba(0, 0, 0, 0.18);
      --radius-xl: 22px;
      --radius-lg: 16px;
      --radius-md: 12px;
      --sans: "Instrument Sans", "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif;
      --mono: "Iosevka Term", "IBM Plex Mono", "SF Mono", monospace;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; scroll-behavior: smooth; }
    body {
      font-family: var(--sans);
      color: var(--text);
      background: linear-gradient(180deg, #111516 0%, #13181a 100%);
    }

    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 24px 22px 48px;
    }

    .quick-nav {
      position: sticky;
      top: 12px;
      z-index: 20;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 18px;
      padding: 12px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(23, 28, 30, 0.94);
      backdrop-filter: blur(14px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
    }

    .quick-nav a {
      text-decoration: none;
      color: var(--text);
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid transparent;
      background: transparent;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      transition: background 120ms ease, transform 120ms ease, border-color 120ms ease;
      white-space: nowrap;
    }

    .quick-nav a:hover {
      transform: none;
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--line);
    }

    .hero {
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
        var(--bg-elevated);
      box-shadow: var(--shadow);
      padding: 24px;
      margin-bottom: 18px;
    }

    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
      gap: 18px;
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
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .eyebrow .pulse {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: none;
    }

    h1 {
      margin: 14px 0 8px;
      font-size: clamp(1.9rem, 4vw, 3rem);
      line-height: 1.02;
      letter-spacing: -0.04em;
      max-width: 16ch;
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
      background: rgba(255, 255, 255, 0.03);
      border-radius: var(--radius-lg);
      padding: 14px 16px;
      min-height: 78px;
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
    }

    .hero-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .hero-context {
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.6;
      margin-top: 12px;
      overflow-wrap: anywhere;
      word-break: break-word;
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
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .control-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }

    .section-caption {
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.6;
    }

    code {
      font-family: var(--mono);
      font-size: 0.95em;
      color: var(--text);
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
      transform: none;
    }

    button:disabled {
      cursor: not-allowed;
      transform: none;
      opacity: 0.42;
      box-shadow: none;
    }

    .btn-primary {
      color: #fff6f0;
      background: var(--accent);
      box-shadow: none;
    }

    .btn-secondary {
      color: var(--text);
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--line);
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

    .focus-primary {
      background:
        linear-gradient(180deg, rgba(201, 111, 65, 0.08), rgba(201, 111, 65, 0) 28%),
        var(--panel-strong);
      border-color: rgba(201, 111, 65, 0.18);
    }

    .focus-shell {
      display: grid;
      gap: 16px;
    }

    .focus-badge {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .focus-badge.tone-success {
      background: var(--teal-soft);
      border-color: rgba(86, 198, 187, 0.24);
      color: #d2fffa;
    }

    .focus-badge.tone-warning {
      background: var(--gold-soft);
      border-color: rgba(242, 193, 78, 0.24);
      color: #fff0c3;
    }

    .focus-badge.tone-error {
      background: var(--danger-soft);
      border-color: rgba(255, 107, 107, 0.24);
      color: #ffd6d6;
    }

    .focus-badge.tone-info {
      background: var(--accent-soft);
      border-color: rgba(242, 104, 58, 0.24);
      color: #ffe2d6;
    }

    .focus-badge.tone-idle {
      color: var(--muted);
    }

    .focus-title {
      font-size: clamp(1.5rem, 3vw, 2.5rem);
      line-height: 1.06;
      letter-spacing: -0.05em;
      font-weight: 800;
      margin-bottom: 10px;
    }

    .focus-copy {
      margin: 0;
      color: var(--muted);
      font-size: 0.98rem;
      line-height: 1.7;
    }

    .focus-list {
      display: grid;
      gap: 10px;
    }

    .focus-check {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      padding: 12px 14px;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
    }

    .focus-check-mark {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.06);
      color: var(--accent);
      font-size: 0.88rem;
      font-weight: 700;
      margin-top: 1px;
    }

    .focus-check-copy strong {
      display: block;
      font-size: 0.92rem;
      margin-bottom: 4px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .focus-check-copy span {
      display: block;
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.55;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .quick-shell {
      display: grid;
      gap: 12px;
    }

    .quick-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .quick-head-copy {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    .quick-headline {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .quick-meta {
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.6;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .quick-targets {
      display: grid;
      grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .quick-target-field {
      display: grid;
      gap: 8px;
    }

    .quick-target-field.hidden {
      display: none;
    }

    .quick-target-field.hidden + .quick-target-field {
      grid-column: 1 / -1;
    }

    .quick-target-field label {
      color: var(--muted);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .quick-preview {
      display: grid;
      gap: 6px;
      padding: 14px 16px;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
    }

    .quick-preview-label {
      color: var(--muted);
      font-size: 0.74rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .quick-preview-title {
      font-size: 0.94rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .quick-preview-copy {
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.6;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .quick-preview.tone-note {
      border-color: rgba(255, 255, 255, 0.08);
    }

    .quick-preview.tone-task {
      border-color: rgba(201, 111, 65, 0.24);
      background: rgba(201, 111, 65, 0.08);
    }

    .quick-preview.tone-answer {
      border-color: rgba(79, 155, 140, 0.24);
      background: rgba(79, 155, 140, 0.08);
    }

    .quick-preview.tone-action {
      border-color: rgba(183, 143, 63, 0.24);
      background: rgba(183, 143, 63, 0.08);
    }

    .quick-preview.tone-warning {
      border-color: rgba(193, 93, 93, 0.24);
      background: rgba(193, 93, 93, 0.08);
    }

    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .quick-actions-meta {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    .quick-shortcuts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .shortcut-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 700;
      box-shadow: none;
    }

    .shortcut-chip:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .stat-card, .card {
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      background: var(--panel);
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

    .expander {
      display: block;
    }

    .expander > summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 14px;
    }

    .expander > summary::-webkit-details-marker {
      display: none;
    }

    .expander[open] .expander-indicator {
      transform: rotate(180deg);
    }

    .expander-indicator {
      color: var(--muted);
      font-size: 0.92rem;
      transition: transform 140ms ease;
    }

    .expander-body {
      border-top: 1px solid var(--line);
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
      overflow-wrap: anywhere;
      word-break: break-word;
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
      overflow-wrap: anywhere;
      word-break: break-word;
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
      transform: none;
    }

    .task-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }

    .task-row > div:first-child {
      min-width: 0;
    }

    .task-title {
      font-weight: 700;
      font-size: 0.96rem;
      margin-bottom: 4px;
      overflow-wrap: anywhere;
      word-break: break-word;
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
      overflow-wrap: anywhere;
      word-break: break-word;
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

    .task-toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(220px, 320px);
      gap: 12px;
      margin-bottom: 14px;
      align-items: center;
    }

    .segmented {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .segmented button {
      width: auto;
    }

    .segment-button {
      padding: 9px 14px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--muted);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: none;
    }

    .segment-button.active {
      background: rgba(86, 198, 187, 0.16);
      border-color: rgba(86, 198, 187, 0.24);
      color: #d5fbf7;
    }

    .toolbar-input {
      min-height: 44px;
    }

    .composer-shell {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.03);
      padding: 16px;
      margin-bottom: 14px;
    }

    .task-import-shell {
      margin-bottom: 18px;
    }

    .composer-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .composer-title {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }

    .task-recency {
      margin-top: 10px;
      color: var(--muted);
      font-size: 0.78rem;
    }

    .criteria-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .criteria-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--muted);
      font-size: 0.74rem;
      line-height: 1.4;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .import-preview-list {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }

    .import-preview-item {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 12px;
      background: rgba(255,255,255,0.02);
    }

    .import-preview-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }

    .import-preview-index {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.76rem;
      white-space: nowrap;
    }

    .import-preview-title {
      font-weight: 700;
      font-size: 0.94rem;
      line-height: 1.5;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .import-preview-summary {
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.55;
      overflow-wrap: anywhere;
      word-break: break-word;
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
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .conversation-meta {
      color: var(--muted);
      font-size: 0.78rem;
    }

    .list-section {
      display: grid;
      gap: 12px;
    }

    .list-section + .list-section {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .list-section-title {
      color: var(--text);
      font-size: 0.92rem;
      font-weight: 700;
      letter-spacing: -0.02em;
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

    input:disabled, textarea:disabled, select:disabled {
      opacity: 0.58;
      cursor: not-allowed;
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

    .field-hint {
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.55;
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
      overflow-wrap: anywhere;
      word-break: break-word;
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
      overflow-wrap: anywhere;
      word-break: break-word;
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

    .onboarding-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .onboarding-step {
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.03);
      padding: 16px;
    }

    .onboarding-step strong {
      display: block;
      font-size: 0.96rem;
      margin-bottom: 8px;
    }

    .onboarding-step p {
      margin: 0;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.6;
    }

    @media (max-width: 1180px) {
      .hero-grid,
      .stats,
      .task-toolbar,
      .quick-targets {
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
      .hero-meta,
      .task-toolbar,
      .quick-targets {
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

      .onboarding-grid {
        grid-template-columns: 1fr;
      }

      .settings-field.span-3 {
        grid-column: span 1;
      }

      .quick-nav {
        top: 8px;
        overflow-x: auto;
        flex-wrap: nowrap;
        padding: 10px;
      }

      .composer-head,
      .expander > summary {
        flex-direction: column;
        align-items: flex-start;
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
            状況確認、次の一手、Task 操作をひとつの流れで扱えるように再構成した管制画面です。
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
            <div id="heroReadiness" class="focus-badge tone-idle">待機中</div>
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
                <div class="meta-label">人の入力</div>
                <div id="heroAttention" class="meta-value" style="font-size:0.95rem; line-height:1.4;">-</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">更新時刻</div>
                <div id="heroUpdated" class="meta-value" style="font-size:0.95rem;">-</div>
              </div>
            </div>
            <div class="control-row">
              <button id="refreshButton" class="btn-secondary" onclick="refreshDashboard()">更新</button>
              <button id="startButton" class="btn-primary" onclick="startRun()">実行開始</button>
              <button id="pauseButton" class="btn-warn" onclick="pauseRun()">一時停止</button>
              <button id="resumeButton" class="btn-secondary" onclick="resumeRun()">再開</button>
              <button id="abortButton" class="btn-danger" onclick="confirmAbort()">中断</button>
            </div>
            <div id="heroControlHint" class="hero-context">最初の Task と設定が揃うと開始できます。</div>
            <div id="heroContext" class="hero-context">通常実行 / コマンド未設定</div>
          </div>
        </div>
      </div>
    </section>

    <nav class="quick-nav" aria-label="セクション移動">
      <a href="#focusSection">いまやること</a>
      <a href="#taskSection">Task</a>
      <a href="#humanLoopSection">質問</a>
      <a href="#agentsSection">レーン</a>
      <a href="#signalsSection">通知</a>
      <a href="#settingsSection">設定</a>
      <a href="#logSection">ログ</a>
    </nav>

    <section id="focusSection" class="board" style="margin-bottom:18px;">
      <article class="card span-7 focus-primary">
        <div class="card-header">
          <div>
            <div class="card-title">いまやること</div>
            <div class="card-subtitle">状態から次の一手を組み立てて、迷わず次へ進めます。</div>
          </div>
          <span id="focusMeta" class="pill">Next Step</span>
        </div>
        <div class="card-body">
          <div class="focus-shell">
            <div id="focusBadge" class="focus-badge tone-idle">待機中</div>
            <div>
              <div id="focusTitle" class="focus-title">最初の Task を作成してください</div>
              <p id="focusCopy" class="focus-copy">まだ Task がありません。いま着手する 1 件目を作ると、ここから運用を始められます。</p>
            </div>
            <div id="focusChecklist" class="focus-list"></div>
            <div id="focusActions" class="control-row"></div>
          </div>
        </div>
      </article>

      <article class="card span-5">
        <div class="card-header">
          <div>
            <div class="card-title">現在と次</div>
            <div class="card-subtitle">今の Task と、終わった後に渡す Task を固定表示します。</div>
          </div>
          <span id="pipelineMeta" class="pill">Task Flow</span>
        </div>
        <div class="card-body">
          <div id="taskFlow" class="conversation-list"></div>
        </div>
      </article>
    </section>

    <section class="board" style="margin-bottom:18px;">
      <article id="quickSendSection" class="card span-12">
        <div class="card-header">
          <div>
            <div class="card-title">クイック送信</div>
            <div class="card-subtitle">この入力欄を起点に、メモ送信、Task 追加、質問への回答を切り替えます。</div>
          </div>
          <span id="quickModeMeta" class="pill">メモ</span>
        </div>
        <div class="card-body">
          <div class="quick-shell">
            <div class="quick-head">
              <div class="quick-head-copy">
                <div id="quickHeadline" class="quick-headline">まずはメモとして送れます</div>
                <div id="quickStatus" class="quick-meta">プレーンテキストは次ターン用メモになります。必要なときだけ Task 追加や回答に切り替えます。</div>
              </div>
              <div id="quickModeTabs" class="segmented">
                <button type="button" class="segment-button active" data-quick-mode="note">メモ</button>
                <button type="button" class="segment-button" data-quick-mode="task">Task 追加</button>
                <button type="button" class="segment-button" data-quick-mode="answer">質問に回答</button>
              </div>
            </div>
            <div class="quick-targets">
              <div id="quickAnswerField" class="quick-target-field hidden">
                <label for="quickAnswerTarget">回答先の質問</label>
                <select id="quickAnswerTarget"></select>
              </div>
              <div class="quick-target-field">
                <label for="quickInput">送る内容</label>
                <textarea id="quickInput" rows="4" placeholder="次ターンに伝えたいことを、そのまま書いて送信できます"></textarea>
              </div>
            </div>
            <div id="quickPreview" class="quick-preview tone-note">
              <div class="quick-preview-label">送信前プレビュー</div>
              <div id="quickPreviewTitle" class="quick-preview-title">まだ何も送られません</div>
              <div id="quickPreviewCopy" class="quick-preview-copy">入力すると、この欄で送信先と動作を先に確認できます。下書きはブラウザ内に自動保存します。</div>
            </div>
            <div class="quick-actions">
              <div class="quick-actions-meta">
                <div id="quickHint" class="section-caption"><code>/chat</code>、<code>/task</code>、<code>/answer Q-001 ...</code>、<code>/start</code> も使えます。<code>Ctrl+Enter</code> で送信します。</div>
              </div>
              <div class="control-row" style="margin-top:0;">
                <button id="quickSendButton" type="button" class="btn-primary" onclick="sendQuickInput()">送信</button>
                <button type="button" class="btn-secondary" onclick="clearQuickInput()">クリア</button>
              </div>
            </div>
            <div id="quickShortcuts" class="quick-shortcuts">
              <button type="button" class="shortcut-chip" data-quick-shortcut="note">方針メモを送る</button>
              <button type="button" class="shortcut-chip" data-quick-shortcut="task">次の Task を足す</button>
              <button type="button" class="shortcut-chip" data-quick-shortcut="answer">質問に返答する</button>
            </div>
          </div>
        </div>
      </article>
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

    <section id="onboardingSection" class="board" style="display:none; margin-bottom:18px;">
      <article class="card span-12">
        <div class="card-header">
          <div>
            <div class="card-title">はじめ方</div>
            <div class="card-subtitle">空の状態からそのまま使えるように、最初の流れをここにまとめます。</div>
          </div>
          <span class="pill">初回ガイド</span>
        </div>
        <div class="card-body">
          <div class="onboarding-grid">
            <div class="onboarding-step">
              <strong>1. 最初のTaskを作る</strong>
              <p>Task 入力欄に、今やる 1 件目の Task と完了条件を書きます。</p>
            </div>
            <div class="onboarding-step">
              <strong>2. 実行設定を確認する</strong>
              <p>思考回数、prompt、実行コマンドを見直して、この環境で本当に動く設定にします。</p>
            </div>
            <div class="onboarding-step">
              <strong>3. 実行して次Taskへ渡す</strong>
              <p>実行開始後は現在のTaskに集中し、終わったら完了チェックを付けて次のTaskを次回に回します。</p>
            </div>
          </div>
          <div class="control-row">
            <button type="button" class="btn-primary" onclick="focusTaskComposer()">最初のTaskを入力する</button>
            <button type="button" class="btn-secondary" onclick="focusSettings()">実行設定を見る</button>
          </div>
        </div>
      </article>
    </section>

    <section class="board">
      <article id="taskSection" class="card span-7">
        <div class="card-header">
          <div>
            <div class="card-title">Task ワークスペース</div>
            <div class="card-subtitle">追加、編集、完了チェックまでをひと続きで操作します。</div>
          </div>
          <span id="taskMeta" class="pill">0 件</span>
        </div>
        <div class="card-body">
          <div class="composer-shell">
            <div class="composer-head">
              <div>
                <div id="taskComposerMode" class="composer-title">新しい Task を追加</div>
                <div id="taskComposerHint" class="section-caption">最初の 1 件目でも、次に回す Task でもここから追加できます。</div>
              </div>
              <button type="button" class="btn-secondary" onclick="resetTaskEditor()">入力をクリア</button>
            </div>
            <form class="note-form" onsubmit="submitTask(event)" style="margin-bottom:0;">
              <input id="taskEditorId" type="hidden" />
              <input id="taskTitle" placeholder="最初の Task、または追加したい Task 名" />
              <textarea id="taskSummary" rows="3" placeholder="Task の説明や完了条件"></textarea>
              <div class="control-row" style="margin-top:0;">
                <button type="submit" class="btn-primary">Task を保存</button>
                <button type="button" class="btn-secondary" onclick="focusSection('focusSection')">上の要約へ戻る</button>
              </div>
            </form>
          </div>
          <div class="composer-shell task-import-shell">
            <div class="composer-head">
              <div>
                <div class="composer-title">仕様書からまとめて Task を作る</div>
                <div class="section-caption">見出し、番号付きリスト、チェックリスト、JSON の <code>userStories</code> / <code>tasks</code> をそのまま貼れます。</div>
              </div>
              <button type="button" class="btn-secondary" onclick="resetTaskImport()">貼り付けをクリア</button>
            </div>
            <form class="note-form" onsubmit="previewTaskImport(event)" style="margin-bottom:0;">
              <textarea
                id="taskImportInput"
                rows="8"
                placeholder="仕様書や要件メモをそのまま貼り付けます。&#10;&#10;例:&#10;## 認証&#10;- ログインAPIを追加する&#10;  - 失敗時に 401 を返す&#10;- セッションを保持する"
              ></textarea>
              <div class="control-row" style="margin-top:0;">
                <button id="taskImportPreviewButton" type="submit" class="btn-secondary">解析プレビュー</button>
                <button id="taskImportApplyButton" type="button" class="btn-primary" onclick="importTaskSpec()">この内容で一括追加</button>
              </div>
            </form>
            <div id="taskImportStatus" class="section-caption">仕様書を貼ると、Task 候補をここで確認できます。</div>
            <div id="taskImportPreview" class="import-preview-list">
              <div class="empty">まだ解析していません</div>
            </div>
          </div>
          <div class="task-toolbar">
            <div id="taskFilters" class="segmented">
              <button type="button" class="segment-button active" data-task-filter="open">未完了</button>
              <button type="button" class="segment-button" data-task-filter="focus">現在と次</button>
              <button type="button" class="segment-button" data-task-filter="completed">完了済み</button>
              <button type="button" class="segment-button" data-task-filter="all">すべて</button>
            </div>
            <input id="taskSearch" class="toolbar-input" placeholder="Task を検索" />
          </div>
          <div id="taskBoardSummary" class="section-caption" style="margin-bottom:14px;">未完了 Task を表示します。</div>
          <div id="taskBoard" class="task-list"></div>
        </div>
      </article>

      <article id="humanLoopSection" class="card span-5">
        <div class="card-header">
          <div>
            <div class="card-title">人の確認待ち</div>
            <div class="card-subtitle">いま答える質問と、次ターンに差し込むメモをここに集約します。</div>
          </div>
          <span id="questionMeta" class="pill">0 件</span>
        </div>
        <div class="card-body">
          <div id="conversationSummary" class="section-caption" style="margin-bottom:14px;">確認待ちはありません。</div>
          <div id="conversationList" class="conversation-list"></div>
          <div class="list-section" style="margin-top:16px;">
            <div class="list-section-title">送信の考え方</div>
            <div class="section-caption">メモも回答も上のクイック送信から入れます。複数の入力欄を探さなくて済むように、送信口をひとつに寄せています。</div>
          </div>
          <div class="control-row">
            <button type="button" class="btn-primary" onclick="focusQuickComposer('note')">メモを送る</button>
            <button type="button" class="btn-secondary" onclick="focusQuickComposer('answer')">質問に回答する</button>
          </div>
        </div>
      </article>

      <article id="agentsSection" class="card span-6">
        <div class="card-header">
          <div>
            <div class="card-title">エージェント状況</div>
            <div class="card-subtitle">監督、計画、実行、統合の役割を同じ画面で追えます。</div>
          </div>
          <span id="laneMeta" class="pill">0 レーン</span>
        </div>
        <div class="card-body">
          <div id="agentLanes" class="lane-grid"></div>
        </div>
      </article>

      <article id="signalsSection" class="card span-6">
        <div class="card-header">
          <div>
            <div class="card-title">要対応と最近の動き</div>
            <div class="card-subtitle">Blocker、差し込み待ち、イベントを優先順にまとめます。</div>
          </div>
          <span id="signalMeta" class="pill">監視中</span>
        </div>
        <div class="card-body">
          <div id="signalSummary" class="section-caption" style="margin-bottom:14px;">要対応はまだありません。</div>
          <div id="signalList" class="signal-list"></div>
          <div class="list-section" style="margin-top:18px;">
            <div class="list-section-title">最近のイベント</div>
            <div class="section-caption">直近の状態変化だけを残しているので、異常や手動操作の確認に使えます。</div>
          </div>
          <div id="eventList" class="event-list" style="margin-top:12px;"></div>
        </div>
      </article>

      <article id="settingsSection" class="card span-12">
        <details id="settingsDetails" class="expander">
          <summary>
            <div>
              <div class="card-title">実行設定</div>
              <div id="settingsPreview" class="card-subtitle">Task / prompt / 思考回数を必要なときだけ開いて見直せます。</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span id="settingsMeta" class="pill">実行設定</span>
              <span class="expander-indicator">^</span>
            </div>
          </summary>
          <div class="expander-body">
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
                  <div id="settingsAgentCommandHint" class="field-hint">起動中のコマンドは確認できます。</div>
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
          </div>
        </details>
      </article>

      <article id="logSection" class="card span-12">
        <details id="logDetails" class="expander">
          <summary>
            <div>
              <div class="card-title">エージェント出力</div>
              <div class="card-subtitle">デバッグや確認が必要なときだけ、生の出力を開いて追えます。</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span id="logMeta" class="pill">出力ログ</span>
              <span class="expander-indicator">^</span>
            </div>
          </summary>
          <div class="expander-body">
            <pre id="agentLog">読み込み中...</pre>
          </div>
        </details>
      </article>
    </section>
  </div>

  <script>
    let thinkingFrames = ['Ralph が考えています...'];
    let thinkingIndex = 0;
    let thinkingSwapTimer = null;
    let flashTimer = null;
    let settingsDirty = false;
    let latestDashboard = null;
    let runtimeCapabilities = { canEditAgentCommand: false };
    let taskFilter = 'open';
    let taskSearchQuery = '';
    let quickMode = 'note';
    let quickAnswerId = '';
    let quickSendInFlight = false;
    let taskImportPreview = null;
    let taskImportPreviewSource = '';
    let taskImportBusy = false;
    const QUICK_DRAFT_STORAGE_KEY = 'ralph.quickDrafts.v1';
    let quickDrafts = loadQuickDrafts();

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

    function shortText(value, maxLength = 72) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (text.length <= maxLength) {
        return text;
      }
      return text.slice(0, Math.max(0, maxLength - 1)) + '…';
    }

    function loadQuickDrafts() {
      try {
        const raw = window.localStorage.getItem(QUICK_DRAFT_STORAGE_KEY);
        if (!raw) {
          return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }

    function saveQuickDrafts() {
      try {
        const entries = Object.entries(quickDrafts).filter((entry) => typeof entry[1] === 'string' && entry[1].trim());
        if (entries.length === 0) {
          window.localStorage.removeItem(QUICK_DRAFT_STORAGE_KEY);
          return;
        }
        window.localStorage.setItem(QUICK_DRAFT_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
      } catch {
        // localStorage is best-effort only.
      }
    }

    function quickDraftKey(mode = quickMode, questionId = quickAnswerId) {
      return mode === 'answer' ? 'answer:' + (questionId || 'none') : mode;
    }

    function readQuickDraft(mode = quickMode, questionId = quickAnswerId) {
      const value = quickDrafts[quickDraftKey(mode, questionId)];
      return typeof value === 'string' ? value : '';
    }

    function writeQuickDraft(value, mode = quickMode, questionId = quickAnswerId) {
      const key = quickDraftKey(mode, questionId);
      const normalized = String(value || '');
      if (normalized.trim()) {
        quickDrafts[key] = normalized;
      } else {
        delete quickDrafts[key];
      }
      saveQuickDrafts();
    }

    function syncQuickDraftFromInput(mode = quickMode, questionId = quickAnswerId) {
      const input = document.getElementById('quickInput');
      if (!(input instanceof HTMLTextAreaElement)) {
        return;
      }
      writeQuickDraft(input.value, mode, questionId);
    }

    function taskStatusLabel(value) {
      if (value === 'active') return '現在';
      if (value === 'queued') return '待機';
      if (value === 'completed') return '完了';
      return '停止';
    }

    function priorityLabel(value) {
      if (value === 'critical') return '最重要';
      if (value === 'high') return '高';
      if (value === 'medium') return '中';
      return '低';
    }

    function phaseLabel(value) {
      if (value === 'queued') return '実行予約';
      if (value === 'starting') return '開始中';
      if (value === 'running') return '実行中';
      if (value === 'paused') return '一時停止';
      if (value === 'completed') return '完了';
      if (value === 'aborted') return '中断';
      if (value === 'failed') return '失敗';
      if (value === 'interrupted') return '中断復帰';
      if (value === 'max_iterations_reached') return '思考回数上限';
      return '待機中';
    }

    function focusSection(sectionId) {
      const section = document.getElementById(sectionId);
      if (!section) {
        return;
      }

      const details = section instanceof HTMLDetailsElement
        ? section
        : section.querySelector('details');
      if (details instanceof HTMLDetailsElement) {
        details.open = true;
      }

      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function focusTaskComposer() {
      focusSection('taskSection');
      const input = document.getElementById('taskTitle');
      input.focus();
    }

    function focusSettings() {
      const details = document.getElementById('settingsDetails');
      if (details instanceof HTMLDetailsElement) {
        details.open = true;
      }
      focusSection('settingsSection');
      const input = document.getElementById('settingsTaskName');
      input.focus();
    }

    function setQuickMode(mode, options = {}) {
      syncQuickDraftFromInput();
      quickMode = mode;
      if (typeof options.questionId === 'string') {
        quickAnswerId = options.questionId;
      }
      if (latestDashboard) {
        renderQuickComposer(latestDashboard);
      }
    }

    function focusQuickComposer(mode = quickMode, options = {}) {
      const previousMode = quickMode;
      const previousAnswerId = quickAnswerId;
      setQuickMode(mode, options);
      focusSection('quickSendSection');

      const input = document.getElementById('quickInput');
      if (input instanceof HTMLTextAreaElement) {
        if (typeof options.prefill === 'string') {
          input.value = options.prefill;
          writeQuickDraft(input.value);
        } else if (
          previousMode !== quickMode ||
          previousAnswerId !== quickAnswerId ||
          !input.value.trim()
        ) {
          input.value = readQuickDraft();
        }
        renderQuickPreview(latestDashboard);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }

    function clearQuickInput() {
      const input = document.getElementById('quickInput');
      if (input instanceof HTMLTextAreaElement) {
        input.value = '';
        writeQuickDraft('');
        renderQuickPreview(latestDashboard);
        input.focus();
      }
    }

    function parseTaskDraft(text) {
      const trimmed = String(text || '').trim();
      if (!trimmed) {
        return { title: '', summary: '' };
      }

      const pipeIndex = trimmed.indexOf('|');
      if (pipeIndex >= 0) {
        const title = trimmed.slice(0, pipeIndex).trim();
        const summary = trimmed.slice(pipeIndex + 1).trim() || title;
        return { title, summary };
      }

      const lines = trimmed.split('\n');
      const title = lines.shift()?.trim() || '';
      const summary = lines.join('\n').trim() || title;
      return { title, summary };
    }

    function parseQuickSlashCommand(text) {
      const trimmed = String(text || '').trim();
      if (!trimmed.startsWith('/')) {
        return null;
      }

      const firstSpace = trimmed.indexOf(' ');
      const command = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
      const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

      if (['/chat', '/note', '/memo'].includes(command)) {
        if (!rest) {
          throw new Error('メモ内容を入力してください');
        }
        return { kind: 'note', note: rest };
      }

      if (['/task', '/todo'].includes(command)) {
        const draft = parseTaskDraft(rest);
        if (!draft.title) {
          throw new Error('Task 名を入力してください');
        }
        return { kind: 'task', title: draft.title, summary: draft.summary };
      }

      if (command === '/answer') {
        const match = rest.match(/^([a-z]+-\d+)\s+([\s\S]+)$/i);
        if (!match) {
          throw new Error('/answer は /answer Q-001 回答内容 の形式で入力してください');
        }
        return {
          kind: 'answer',
          questionId: match[1].toUpperCase(),
          answer: match[2].trim(),
        };
      }

      if (command === '/start' || command === '/run') {
        return { kind: 'action', action: 'start' };
      }

      if (command === '/pause') {
        return { kind: 'action', action: 'pause' };
      }

      if (command === '/resume') {
        return { kind: 'action', action: 'resume' };
      }

      if (command === '/abort') {
        return { kind: 'action', action: 'abort' };
      }

      if (command === '/help') {
        return { kind: 'help' };
      }

      throw new Error('未対応のコマンドです。/help で使い方を確認できます');
    }

    function quickActionLabel(action) {
      if (action === 'start') return '実行開始';
      if (action === 'pause') return '一時停止';
      if (action === 'resume') return '再開';
      if (action === 'abort') return '中断';
      return '操作';
    }

    function quickPreviewStateFromCommand(command, pending) {
      if (command.kind === 'help') {
        return {
          tone: 'tone-action',
          title: 'クイック送信の使い方を表示します',
          copy: '/chat, /task, /answer, /start などの使い方をその場で確認します。',
        };
      }

      if (command.kind === 'note') {
        return {
          tone: 'tone-note',
          title: '次ターン用のメモとして送信します',
          copy: shortText(command.note, 140),
        };
      }

      if (command.kind === 'task') {
        return {
          tone: 'tone-task',
          title: command.title + ' を Task として追加します',
          copy: shortText(command.summary || command.title, 140),
        };
      }

      if (command.kind === 'answer') {
        const targetQuestion = pending.find((item) => item.id === command.questionId);
        return {
          tone: targetQuestion ? 'tone-answer' : 'tone-warning',
          title: command.questionId + ' に回答します',
          copy: targetQuestion
            ? shortText(command.answer, 140)
            : 'その質問は現在の pending 一覧にありません。送信前に ID を確認してください。',
        };
      }

      if (command.kind === 'action') {
        return {
          tone: 'tone-action',
          title: quickActionLabel(command.action) + ' を要求します',
          copy: '実行制御だけを送ります。本文は保存されず、そのまま操作として処理されます。',
        };
      }

      return {
        tone: 'tone-note',
        title: '次ターン用のメモとして送信します',
        copy: '送信前に内容を確認してください。',
      };
    }

    function buildQuickPreviewState(data) {
      const input = document.getElementById('quickInput');
      const text = input instanceof HTMLTextAreaElement ? input.value.trim() : '';
      const pending = data?.pendingQuestions || [];
      const currentQuestion = pending.find((item) => item.id === quickAnswerId);

      if (!text) {
        if (quickMode === 'task') {
          return {
            tone: 'tone-task',
            title: '新しい Task を追加します',
            copy: '1 行目を Task 名、2 行目以降または「タイトル | 説明」の右側を説明として扱います。下書きはブラウザ内に自動保存します。',
          };
        }

        if (quickMode === 'answer') {
          return {
            tone: currentQuestion ? 'tone-answer' : 'tone-warning',
            title: currentQuestion
              ? currentQuestion.id + ' へ回答します'
              : '回答先の質問を選んでください',
            copy: currentQuestion
              ? shortText(currentQuestion.text, 140)
              : 'pending の質問があるときだけ回答できます。下書きは質問ごとに保持します。',
          };
        }

        return {
          tone: 'tone-note',
          title: '次ターン用のメモとして送ります',
          copy: '方針、注意点、優先順位をそのまま書けます。下書きはブラウザ内に自動保存します。',
        };
      }

      try {
        const slashCommand = parseQuickSlashCommand(text);
        if (slashCommand) {
          return quickPreviewStateFromCommand(slashCommand, pending);
        }
      } catch (error) {
        return {
          tone: 'tone-warning',
          title: 'この入力はそのまま送信できません',
          copy: error instanceof Error ? error.message : String(error),
        };
      }

      if (quickMode === 'task') {
        const draft = parseTaskDraft(text);
        return {
          tone: draft.title ? 'tone-task' : 'tone-warning',
          title: draft.title
            ? draft.title + ' を Task として追加します'
            : 'Task 名が必要です',
          copy: draft.title
            ? shortText(draft.summary || draft.title, 140)
            : '1 行目か「タイトル | 説明」の左側に Task 名を入れてください。',
        };
      }

      if (quickMode === 'answer') {
        return {
          tone: currentQuestion ? 'tone-answer' : 'tone-warning',
          title: currentQuestion
            ? currentQuestion.id + ' に回答します'
            : '回答先の質問がありません',
          copy: currentQuestion
            ? shortText(text, 140)
            : 'この文章はまだ回答として送れません。必要ならメモに切り替えて送信してください。',
        };
      }

      return {
        tone: 'tone-note',
        title: '次ターン用のメモとして送信します',
        copy: shortText(text, 140),
      };
    }

    function renderQuickPreview(data) {
      const preview = buildQuickPreviewState(data);
      const shell = document.getElementById('quickPreview');
      if (!(shell instanceof HTMLElement)) {
        return;
      }

      shell.className = 'quick-preview ' + preview.tone;
      document.getElementById('quickPreviewTitle').textContent = preview.title;
      document.getElementById('quickPreviewCopy').textContent = preview.copy;
    }

    function renderQuickComposer(data) {
      const pending = data.pendingQuestions || [];
      const answerModeButton = document.querySelector('[data-quick-mode="answer"]');
      const answerField = document.getElementById('quickAnswerField');
      const answerTarget = document.getElementById('quickAnswerTarget');
      const quickInput = document.getElementById('quickInput');

      if (!quickAnswerId && pending.length > 0) {
        quickAnswerId = pending[0]?.id || '';
      }

      const hasSelectedAnswerTarget = Boolean(quickAnswerId) && pending.some((item) => item.id === quickAnswerId);

      if (answerModeButton instanceof HTMLButtonElement) {
        answerModeButton.disabled = pending.length === 0;
      }

      document.querySelectorAll('[data-quick-mode]').forEach((button) => {
        button.classList.toggle('active', button.dataset.quickMode === quickMode);
      });

      if (answerField instanceof HTMLElement) {
        answerField.classList.toggle('hidden', quickMode !== 'answer');
      }

      if (answerTarget instanceof HTMLSelectElement) {
        if (pending.length > 0) {
          const options = pending.map((item) => \`
            <option value="\${escapeHtml(item.id)}">\${escapeHtml(item.id + ' / ' + shortText(item.text, 56))}</option>
          \`).join('');
          answerTarget.innerHTML =
            quickMode === 'answer' && quickAnswerId && !hasSelectedAnswerTarget
              ? '<option value="">解決済みの質問を選択していました。送信前に選び直してください</option>' + options
              : options;
          answerTarget.value = hasSelectedAnswerTarget ? quickAnswerId : '';
        } else {
          answerTarget.innerHTML = '<option value="">回答待ちの質問はありません</option>';
        }
        answerTarget.disabled = pending.length === 0 || quickSendInFlight;
      }

      const meta = document.getElementById('quickModeMeta');
      const headline = document.getElementById('quickHeadline');
      const status = document.getElementById('quickStatus');
      const hint = document.getElementById('quickHint');

      if (!(quickInput instanceof HTMLTextAreaElement)) {
        return;
      }

      if (quickMode === 'task') {
        meta.textContent = 'Task 追加';
        headline.textContent = '新しい Task をすばやく追加します';
        status.textContent = '1 行目を Task 名、2 行目以降を説明として保存します。完了条件が長くてもそのまま貼れます。';
        hint.innerHTML = '<code>タイトル | 説明</code> でも追加できます。複数件まとめてではなく、1 件ずつ入れる前提です。';
        quickInput.placeholder = '例: 管制画面の余白を調整する\\nモバイルで情報が折り返しても崩れないようにする';
      } else if (quickMode === 'answer') {
        const currentQuestion = pending.find((item) => item.id === quickAnswerId);
        meta.textContent = '質問に回答';
        headline.textContent = currentQuestion
          ? currentQuestion.id + ' に回答します'
          : '回答先の質問が見つかりません';
        status.textContent = currentQuestion
          ? shortText(currentQuestion.text, 120)
          : '回答待ちの質問が解消されました。内容を見直して、必要ならメモへ切り替えて送信してください。';
        hint.innerHTML = currentQuestion
          ? '<code>/answer Q-001 回答内容</code> でも送信できます。回答は次のターンに 1 回だけ差し込まれます。'
          : '回答モードのまま内容は保持しています。送信する前に、回答先か送信モードを確認してください。';
        quickInput.placeholder = '質問への返答や判断をそのまま書いて送信します';
      } else {
        meta.textContent = 'メモ';
        headline.textContent = 'まずはメモとして送れます';
        status.textContent = 'プレーンテキストは次ターン用メモになります。必要なときだけ Task 追加や回答に切り替えます。';
        hint.innerHTML = '<code>/chat</code>、<code>/task</code>、<code>/answer Q-001 ...</code>、<code>/start</code> も使えます。<code>Ctrl+Enter</code> で送信します。';
        quickInput.placeholder = '次ターンに伝えたいことを、そのまま書いて送信できます';
      }

      quickInput.readOnly = quickSendInFlight;

      const sendButton = document.getElementById('quickSendButton');
      if (sendButton instanceof HTMLButtonElement) {
        sendButton.disabled = quickSendInFlight;
        sendButton.textContent = quickSendInFlight ? '送信中...' : '送信';
      }

      renderQuickPreview(data);
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

    function hasSettingsReadiness(settings) {
      if (!settings) {
        return false;
      }

      const hasTaskName = Boolean(String(settings.taskName || '').trim());
      const hasPrompt = Boolean(String(settings.promptBody || '').trim() || String(settings.promptFile || '').trim());
      const hasCommand = settings.mode === 'demo' || Boolean(String(settings.agentCommand || '').trim());
      return hasTaskName && hasPrompt && hasCommand;
    }

    function buildFocusChecklist(data) {
      const currentTask = data.currentTask;
      const nextTask = data.nextTask;
      const settingsReady = hasSettingsReadiness(data.settings);
      const logLines = (data.agentLogTail || []).filter(Boolean).length;

      return [
        {
          title: currentTask ? '現在の Task は決まっています' : '現在の Task はまだありません',
          text: currentTask
            ? currentTask.id + ' / ' + currentTask.title
            : 'まずは Task を 1 件追加して、作業の起点を明確にします。',
        },
        {
          title: nextTask ? '次に渡す Task も見えています' : '次の Task はまだ未設定です',
          text: nextTask
            ? nextTask.id + ' / ' + nextTask.title
            : '1 件目が固まったあとで、次に回す Task を追加できます。',
        },
        {
          title: settingsReady ? '実行設定は揃っています' : '実行設定の見直しが必要です',
          text: settingsReady
            ? (data.settings.mode === 'demo' ? 'デモ' : '通常実行') + ' / ' + data.settings.maxIterations + ' 回'
            : 'Task 名、prompt、コマンドを揃えるとそのまま開始できます。',
        },
        {
          title: data.status.pendingQuestionCount > 0 || data.status.blockerCount > 0
            ? '人の確認が残っています'
            : '人の確認待ちはありません',
          text:
            data.status.pendingQuestionCount + ' 件の質問待ち / ' +
            data.status.blockerCount + ' 件の要対応 / ' +
            data.status.pendingInjectionCount + ' 件の差し込み待ち',
        },
        {
          title: '直近の出力は残っています',
          text: logLines > 0
            ? logLines + ' 行のログを保持しています。必要なときだけ一番下で開けます。'
            : 'まだエージェント出力はありません。',
        },
      ];
    }

    function buildFocusModel(data) {
      const status = data.status;
      const taskCount = (data.taskBoard || []).length;
      const settingsReady = hasSettingsReadiness(data.settings);
      const currentTask = data.currentTask;
      const nextTask = data.nextTask;

      if (taskCount === 0) {
        return {
          tone: 'tone-warning',
          badge: 'Task が必要です',
          meta: 'Setup',
          title: '最初の Task を作成してください',
          copy: 'この画面は Task を起点に動きます。いま着手する 1 件目を決めると、残りの導線が一気に分かりやすくなります。',
          hint: 'Task を追加すると、現在と次の流れが上に固定表示されます。',
          actions: [
            { label: 'Task を入力', className: 'btn-primary', handler: 'focusTaskComposer()' },
            { label: '設定を見る', className: 'btn-secondary', handler: 'focusSettings()' },
          ],
        };
      }

      if (!settingsReady) {
        return {
          tone: 'tone-warning',
          badge: '設定確認',
          meta: 'Ready Check',
          title: '開始前に実行設定を揃えてください',
          copy: 'Task はありますが、そのままでは安全に開始できません。Task 名、prompt、コマンドを埋めると開始ボタンが有効になります。',
          hint: 'promptBody か promptFile、通常実行なら agentCommand が必要です。',
          actions: [
            { label: '設定を開く', className: 'btn-primary', handler: 'focusSettings()' },
            { label: 'Task を見る', className: 'btn-secondary', handler: 'focusSection(\\'taskSection\\')' },
          ],
        };
      }

      if (status.lifecycle === 'failed' && status.lastError) {
        return {
          tone: 'tone-error',
          badge: 'エラー発生',
          meta: 'Recovery',
          title: '前回の実行で障害が発生しました',
          copy: '設定かログを確認してから再実行してください。状態は保持されているので、修正後に同じ Task から再開できます。',
          hint: '直近のイベントとログを確認してから再実行するのが安全です。',
          actions: [
            { label: 'ログを見る', className: 'btn-primary', handler: 'focusSection(\\'logSection\\')' },
            { label: '設定を見る', className: 'btn-secondary', handler: 'focusSettings()' },
          ],
        };
      }

      if (data.blockers.length > 0) {
        return {
          tone: 'tone-error',
          badge: '要対応あり',
          meta: 'Attention',
          title: data.blockers.length + ' 件の要対応があります',
          copy: '処理自体は止めずに進めていますが、ここを見落とすと次の run の質が落ちます。まずは Blocker を確認して、影響範囲を把握してください。',
          hint: '要対応と最近の動きに、Blocker と差し込み待ちを集約しています。',
          actions: [
            { label: '要対応を見る', className: 'btn-primary', handler: 'focusSection(\\'signalsSection\\')' },
            { label: '質問を見る', className: 'btn-secondary', handler: 'focusSection(\\'humanLoopSection\\')' },
          ],
        };
      }

      if (data.pendingQuestions.length > 0) {
        return {
          tone: 'tone-warning',
          badge: '回答待ち',
          meta: 'Human Loop',
          title: data.pendingQuestions.length + ' 件の質問に答えると次ターンが改善します',
          copy: 'Ralph は停止せず進みますが、回答があると次の prompt に一度だけ注入されます。短くてもよいので方針を返すのが最短です。',
          hint: '上のクイック送信から、そのまま回答を返せます。',
          actions: [
            { label: '質問に答える', className: 'btn-primary', handler: 'focusQuickComposer(\\'answer\\')' },
            { label: 'メモを残す', className: 'btn-secondary', handler: 'focusQuickComposer(\\'note\\')' },
          ],
        };
      }

      if (status.phase === 'queued') {
        return {
          tone: 'tone-info',
          badge: '実行予約済み',
          meta: 'Queued',
          title: '実行開始を待機列に置いています',
          copy: 'supervisor が次の run を拾うまで待機しています。いまは Task や質問の見直しをしておくと次のターンの質が上がります。',
          hint: '予約済みの間は開始ボタンを無効化し、他の修正だけを受け付けます。',
          actions: [
            { label: 'Task を見直す', className: 'btn-primary', handler: 'focusSection(\\'taskSection\\')' },
            { label: '状態を更新', className: 'btn-secondary', handler: 'refreshDashboard()' },
          ],
        };
      }

      if (status.lifecycle === 'paused' || status.lifecycle === 'pause_requested') {
        return {
          tone: 'tone-warning',
          badge: '一時停止中',
          meta: 'Paused',
          title: '現在の Task から再開できます',
          copy: '作業状態は保持されています。Task やメモを見直したうえで再開するか、このまま中断するかを選んでください。',
          hint: '再開すると現在の Task から続行し、中断すると安全に今回のターンを閉じます。',
          actions: [
            { label: '再開する', className: 'btn-primary', handler: 'resumeRun()' },
            { label: '中断する', className: 'btn-danger', handler: 'confirmAbort()' },
          ],
        };
      }

      if (status.lifecycle === 'starting' || status.lifecycle === 'running') {
        return {
          tone: 'tone-success',
          badge: '実行中',
          meta: 'Running',
          title: currentTask
            ? currentTask.id + ' を中心に進めています'
            : '現在の run を進めています',
          copy: nextTask && currentTask
            ? '今は ' + currentTask.title + ' を処理中です。終わると ' + nextTask.id + ' が次の候補として前に出ます。'
            : '現在の Task を処理中です。追加でメモや回答があれば、次ターンへ注入されます。',
          hint: '走行中は、回答とメモの投入、Task 更新、必要なら一時停止が中心です。',
          actions: [
            { label: 'メモを送る', className: 'btn-secondary', handler: 'focusQuickComposer(\\'note\\')' },
            { label: 'Task を見る', className: 'btn-primary', handler: 'focusSection(\\'taskSection\\')' },
          ],
        };
      }

      if (status.lifecycle === 'completed') {
        return {
          tone: 'tone-success',
          badge: '完了',
          meta: 'Done',
          title: nextTask
            ? nextTask.id + ' が次の候補として見えています'
            : 'この run は完了しました',
          copy: nextTask
            ? '次の run では ' + nextTask.title + ' から始められます。必要なら Task を整えてから再実行してください。'
            : '残っている Task がなければ、新しい Task を追加して次の run を作れます。',
          hint: '完了後は次 Task の整理か、新しい Task の追加が最も自然な次の操作です。',
          actions: [
            { label: nextTask ? '次の Task を確認' : 'Task を追加', className: 'btn-primary', handler: 'focusTaskComposer()' },
            { label: 'もう一度実行', className: 'btn-secondary', handler: 'startRun()' },
          ],
        };
      }

      return {
        tone: 'tone-success',
        badge: '開始可能',
        meta: 'Ready',
        title: currentTask
          ? currentTask.id + ' から始める準備ができています'
          : '実行を開始できます',
        copy: nextTask
          ? '今やる Task と次に渡す Task が揃っています。設定も揃っているので、そのまま開始して問題ありません。'
          : '現在の Task が決まっていて、実行設定も揃っています。このまま開始できます。',
        hint: '開始すると現在の Task を 1 件進め、次 Task は次回へ渡します。',
        actions: [
          { label: '実行開始', className: 'btn-primary', handler: 'startRun()' },
          { label: 'Task を見直す', className: 'btn-secondary', handler: 'focusSection(\\'taskSection\\')' },
        ],
      };
    }

    function renderFocusSummary(data) {
      const model = buildFocusModel(data);
      const checklist = buildFocusChecklist(data);
      const focusBadge = document.getElementById('focusBadge');
      const heroReadiness = document.getElementById('heroReadiness');

      focusBadge.className = 'focus-badge ' + model.tone;
      focusBadge.textContent = model.badge;
      heroReadiness.className = 'focus-badge ' + model.tone;
      heroReadiness.textContent = model.badge;

      document.getElementById('focusMeta').textContent = model.meta;
      document.getElementById('focusTitle').textContent = model.title;
      document.getElementById('focusCopy').textContent = model.copy;
      document.getElementById('heroControlHint').textContent = model.hint;

      document.getElementById('focusChecklist').innerHTML = checklist.map((item) => \`
        <div class="focus-check">
          <div class="focus-check-mark">+</div>
          <div class="focus-check-copy">
            <strong>\${escapeHtml(item.title)}</strong>
            <span>\${escapeHtml(item.text)}</span>
          </div>
        </div>
      \`).join('');

      document.getElementById('focusActions').innerHTML = model.actions.map((action) => \`
        <button type="button" class="\${escapeHtml(action.className)}" onclick="\${action.handler}">\${escapeHtml(action.label)}</button>
      \`).join('');
    }

    function syncHeroControls(data) {
      const status = data.status;
      const hasTasks = (data.taskBoard || []).length > 0;
      const settingsReady = hasSettingsReadiness(data.settings);

      const startButton = document.getElementById('startButton');
      const pauseButton = document.getElementById('pauseButton');
      const resumeButton = document.getElementById('resumeButton');
      const abortButton = document.getElementById('abortButton');

      startButton.disabled =
        !hasTasks ||
        !settingsReady ||
        status.phase === 'queued' ||
        ['starting', 'running', 'pause_requested', 'paused'].includes(status.lifecycle);
      pauseButton.disabled = !['starting', 'running'].includes(status.lifecycle);
      resumeButton.disabled = !['paused', 'pause_requested'].includes(status.lifecycle);
      abortButton.disabled =
        !['queued', 'starting', 'running', 'pause_requested', 'paused'].includes(status.phase) &&
        !['starting', 'running', 'pause_requested', 'paused'].includes(status.lifecycle);

      startButton.textContent =
        status.phase === 'queued'
          ? '実行予約済み'
          : status.lifecycle === 'completed'
            ? 'もう一度実行'
            : '実行開始';

      document.getElementById('heroAttention').textContent =
        status.pendingQuestionCount + ' 確認 / ' + status.blockerCount + ' 要対応';
      document.getElementById('heroContext').textContent =
        (status.mode === 'demo' ? 'デモ' : '通常実行') + ' / ' +
        (status.agentCommand || (status.mode === 'demo' ? 'demo mode' : 'コマンド未設定'));
    }

    async function postAction(path, payload = {}, options = {}) {
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
      if (options.refresh !== false) {
        await refreshDashboard();
      }
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

    async function confirmAbort() {
      const shouldAbort = window.confirm('現在の run を中断します。よろしいですか。');
      if (!shouldAbort) {
        return false;
      }

      const result = await postAction('/api/abort');
      if (!result) {
        return false;
      }
      showFlash('中断を要求しました', 'warning');
      return true;
    }

    async function startRun() {
      const result = await postAction('/api/start');
      if (!result) {
        return false;
      }
      showFlash(result?.message || '実行を要求しました', result?.started ? 'success' : 'warning');
      return Boolean(result?.started);
    }

    async function pauseRun() {
      const result = await postAction('/api/pause');
      if (!result) {
        return false;
      }
      showFlash('一時停止を要求しました', 'warning');
      return true;
    }

    async function resumeRun() {
      const result = await postAction('/api/resume');
      if (!result) {
        return false;
      }
      showFlash('実行を再開しました', 'success');
      return true;
    }

    async function saveSettings(event) {
      event.preventDefault();
      const result = await postAction('/api/settings', {
        taskName: document.getElementById('settingsTaskName').value.trim(),
        maxIterations: Number.parseInt(document.getElementById('settingsMaxIterations').value, 10),
        idleSeconds: Number.parseInt(document.getElementById('settingsIdleSeconds').value, 10),
        mode: document.getElementById('settingsMode').value,
        agentCommand: runtimeCapabilities.canEditAgentCommand
          ? document.getElementById('settingsAgentCommand').value.trim()
          : undefined,
        promptFile: document.getElementById('settingsPromptFile').value.trim(),
        promptBody: document.getElementById('settingsPromptBody').value,
      });
      if (!result) {
        return;
      }
      settingsDirty = false;
      showFlash('実行設定を保存しました', 'success');
    }

    async function submitAnswer(questionId, providedAnswer) {
      const el = document.getElementById('answer-' + questionId);
      const answer = typeof providedAnswer === 'string'
        ? providedAnswer.trim()
        : el instanceof HTMLTextAreaElement
          ? el.value.trim()
          : '';
      if (!answer) return false;
      const result = await postAction('/api/answer', { questionId, answer });
      if (!result) {
        return false;
      }
      if (el instanceof HTMLTextAreaElement && typeof providedAnswer !== 'string') {
        el.value = '';
      }
      showFlash('回答を保存しました', 'success');
      return true;
    }

    async function submitNote(note) {
      if (!note.trim()) {
        return false;
      }
      const result = await postAction('/api/note', { note });
      if (!result) {
        return false;
      }
      showFlash('メモを追加しました', 'success');
      return true;
    }

    async function runQuickCommand(command) {
      if (command.kind === 'help') {
        showFlash('クイック送信: /chat, /task, /answer Q-001, /start, /pause, /resume, /abort', 'info');
        return true;
      }

      if (command.kind === 'note') {
        return submitNote(command.note);
      }

      if (command.kind === 'task') {
        const result = await postAction('/api/task/create', {
          title: command.title,
          summary: command.summary,
        });
        if (!result) {
          return false;
        }
        showFlash('Task を追加しました', 'success');
        return true;
      }

      if (command.kind === 'answer') {
        const targetQuestion = (latestDashboard?.pendingQuestions || []).find((item) => item.id === command.questionId);
        if (!targetQuestion) {
          showFlash('その質問は現在の pending 一覧にありません。送信前に選び直してください', 'warning');
          return false;
        }
        return submitAnswer(command.questionId, command.answer);
      }

      if (command.kind === 'action') {
        if (command.action === 'start') {
          return startRun();
        }
        if (command.action === 'pause') {
          return pauseRun();
        }
        if (command.action === 'resume') {
          return resumeRun();
        }
        if (command.action === 'abort') {
          return confirmAbort();
        }
      }

      return false;
    }

    async function sendQuickInput() {
      if (quickSendInFlight) {
        return;
      }

      const input = document.getElementById('quickInput');
      if (!(input instanceof HTMLTextAreaElement)) {
        return;
      }

      const text = input.value.trim();
      if (!text) {
        showFlash('送る内容を入力してください', 'warning');
        return;
      }

      setQuickSendBusy(true);
      try {
        const slashCommand = parseQuickSlashCommand(text);
        if (slashCommand) {
          const sent = await runQuickCommand(slashCommand);
          if (sent) {
            input.value = '';
          }
          return;
        }

        if (quickMode === 'task') {
          const draft = parseTaskDraft(text);
          if (!draft.title) {
            showFlash('Task 名を入力してください', 'warning');
            return;
          }
          const sent = await runQuickCommand({
            kind: 'task',
            title: draft.title,
            summary: draft.summary,
          });
          if (sent) {
            input.value = '';
            writeQuickDraft('');
          }
          return;
        }

        if (quickMode === 'answer') {
          const targetQuestion = (latestDashboard?.pendingQuestions || []).find((item) => item.id === quickAnswerId);
          if (!quickAnswerId || !targetQuestion) {
            showFlash('回答先の質問を選び直してください。必要ならメモに切り替えて送信できます', 'warning');
            return;
          }
          const sent = await submitAnswer(quickAnswerId, text);
          if (sent) {
            input.value = '';
            writeQuickDraft('');
          }
          return;
        }

        const sent = await submitNote(text);
        if (sent) {
          input.value = '';
          writeQuickDraft('');
        }
      } catch (error) {
        showFlash(error instanceof Error ? error.message : String(error), 'warning');
      } finally {
        setQuickSendBusy(false);
        if (latestDashboard) {
          renderQuickComposer(latestDashboard);
        }
      }
    }

    function setQuickSendBusy(isBusy) {
      quickSendInFlight = isBusy;
      if (!latestDashboard) {
        return;
      }
      renderQuickComposer(latestDashboard);
    }

    function taskImportFormatLabel(format) {
      if (format === 'json') return 'JSON';
      if (format === 'headings') return '見出し構造';
      if (format === 'list') return '箇条書き';
      return '未解析';
    }

    function renderTaskImportPreview() {
      const input = document.getElementById('taskImportInput');
      const previewEl = document.getElementById('taskImportPreview');
      const statusEl = document.getElementById('taskImportStatus');
      const previewButton = document.getElementById('taskImportPreviewButton');
      const applyButton = document.getElementById('taskImportApplyButton');
      const text = input instanceof HTMLTextAreaElement ? input.value.trim() : '';
      const isCurrent = Boolean(taskImportPreview) && text === taskImportPreviewSource;

      if (previewButton instanceof HTMLButtonElement) {
        previewButton.disabled = taskImportBusy;
        previewButton.textContent = taskImportBusy ? '解析中...' : '解析プレビュー';
      }

      if (applyButton instanceof HTMLButtonElement) {
        applyButton.disabled =
          taskImportBusy ||
          !text ||
          !taskImportPreview ||
          taskImportPreview.tasks.length === 0 ||
          !isCurrent;
        applyButton.textContent = taskImportBusy ? '追加中...' : 'この内容で一括追加';
      }

      if (!(previewEl instanceof HTMLElement) || !(statusEl instanceof HTMLElement)) {
        return;
      }

      if (!text) {
        statusEl.textContent = '仕様書を貼ると、Task 候補をここで確認できます。';
        previewEl.innerHTML = '<div class="empty">まだ解析していません</div>';
        return;
      }

      if (!taskImportPreview) {
        statusEl.textContent = '内容を貼り付けました。解析プレビューで Task 候補を確認できます。';
        previewEl.innerHTML = '<div class="empty">解析前です</div>';
        return;
      }

      const baseStatus = taskImportPreview.tasks.length > 0
        ? taskImportFormatLabel(taskImportPreview.format) + ' から ' + taskImportPreview.tasks.length + ' 件の Task 候補を抽出しました'
        : 'Task に分解できる項目が見つかりませんでした';
      const suffixes = [];
      if (taskImportPreview.truncated) {
        suffixes.push('件数が多いため、先頭 40 件だけ表示しています');
      }
      if (!isCurrent) {
        suffixes.push('内容を変更したので、追加前にもう一度解析してください');
      } else if (taskImportPreview.tasks.length > 0) {
        suffixes.push('問題なければこのまま一括追加できます');
      }

      statusEl.textContent = suffixes.length > 0
        ? baseStatus + '。' + suffixes.join('。') + '。'
        : baseStatus;

      if (taskImportPreview.tasks.length === 0) {
        previewEl.innerHTML = '<div class="empty">Task 候補を作れませんでした。見出しや箇条書きを増やすと抽出しやすくなります。</div>';
        return;
      }

      previewEl.innerHTML = taskImportPreview.tasks.map((item, index) => {
        const criteria = (item.acceptanceCriteria || []).slice(0, 3);
        return \`
          <article class="import-preview-item">
            <div class="import-preview-head">
              <div class="import-preview-title">\${escapeHtml(item.title)}</div>
              <div class="import-preview-index">#\${String(index + 1).padStart(2, '0')}</div>
            </div>
            <div class="import-preview-summary">\${escapeHtml(item.summary || item.title)}</div>
            \${criteria.length > 0
              ? '<div class="criteria-list">' + criteria.map((criterion) => '<span class="criteria-pill">' + escapeHtml(criterion) + '</span>').join('') + '</div>'
              : ''}
            <div class="task-meta">
              <span class="tag">取り込み候補</span>
              \${item.acceptanceCriteria && item.acceptanceCriteria.length > 3
                ? '<span class="tag">条件 ' + escapeHtml(item.acceptanceCriteria.length) + ' 件</span>'
                : ''}
            </div>
          </article>
        \`;
      }).join('');
    }

    function resetTaskImport() {
      const input = document.getElementById('taskImportInput');
      if (input instanceof HTMLTextAreaElement) {
        input.value = '';
      }

      taskImportPreview = null;
      taskImportPreviewSource = '';
      renderTaskImportPreview();
    }

    async function previewTaskImport(event) {
      if (event) {
        event.preventDefault();
      }

      const input = document.getElementById('taskImportInput');
      const specText = input instanceof HTMLTextAreaElement ? input.value.trim() : '';
      if (!specText) {
        showFlash('仕様書を貼り付けてください', 'warning');
        taskImportPreview = null;
        taskImportPreviewSource = '';
        renderTaskImportPreview();
        return;
      }

      taskImportBusy = true;
      renderTaskImportPreview();
      try {
        const preview = await postAction('/api/task/import/preview', { specText }, { refresh: false });
        if (!preview) {
          return;
        }

        taskImportPreview = preview;
        taskImportPreviewSource = specText;
        renderTaskImportPreview();
        showFlash(
          preview.tasks.length > 0
            ? preview.tasks.length + ' 件の Task 候補を抽出しました'
            : 'Task に分解できる項目が見つかりませんでした',
          preview.tasks.length > 0 ? 'success' : 'warning',
        );
      } finally {
        taskImportBusy = false;
        renderTaskImportPreview();
      }
    }

    async function importTaskSpec() {
      const input = document.getElementById('taskImportInput');
      const specText = input instanceof HTMLTextAreaElement ? input.value.trim() : '';
      if (!specText) {
        showFlash('仕様書を貼り付けてください', 'warning');
        return;
      }

      if (!taskImportPreview || taskImportPreviewSource !== specText) {
        await previewTaskImport();
        if (!taskImportPreview || taskImportPreviewSource !== specText) {
          return;
        }
      }

      if (taskImportPreview.tasks.length === 0) {
        showFlash('Task に分解できる項目がないため追加できません', 'warning');
        return;
      }

      taskImportBusy = true;
      renderTaskImportPreview();
      try {
        const result = await postAction('/api/task/import', { specText });
        if (!result) {
          return;
        }

        const count = Array.isArray(result.tasks) ? result.tasks.length : taskImportPreview.tasks.length;
        showFlash(count + ' 件の Task を追加しました', 'success');
        resetTaskImport();
      } finally {
        taskImportBusy = false;
        renderTaskImportPreview();
      }
    }

    function resetTaskEditor() {
      document.getElementById('taskEditorId').value = '';
      document.getElementById('taskTitle').value = '';
      document.getElementById('taskSummary').value = '';
      document.getElementById('taskComposerMode').textContent = '新しい Task を追加';
      document.getElementById('taskComposerHint').textContent =
        '最初の 1 件目でも、次に回す Task でもここから追加できます。';
    }

    function beginTaskEdit(taskId, title, summary) {
      document.getElementById('taskEditorId').value = taskId;
      document.getElementById('taskTitle').value = title;
      document.getElementById('taskSummary').value = summary || '';
      document.getElementById('taskComposerMode').textContent = taskId + ' を編集中';
      document.getElementById('taskComposerHint').textContent =
        '編集後に保存すると、この Task のタイトルと説明を更新します。';
      focusTaskComposer();
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

    async function moveTask(taskId, position) {
      const result = await postAction('/api/task/move', { taskId, position });
      if (!result) {
        return;
      }
      showFlash(
        position === 'front'
          ? taskId + ' を最優先にしました'
          : taskId + ' を後ろへ回しました',
        'success',
      );
    }

    function filterTaskItems(items, currentTask, nextTask) {
      const query = taskSearchQuery.trim().toLowerCase();
      let filtered = [...items];

      if (taskFilter === 'open') {
        filtered = filtered.filter((item) => item.displayStatus !== 'completed');
      } else if (taskFilter === 'focus') {
        filtered = filtered.filter((item) =>
          item.id === currentTask?.id ||
          item.id === nextTask?.id,
        );
      } else if (taskFilter === 'completed') {
        filtered = filtered.filter((item) => item.displayStatus === 'completed');
      }

      if (query) {
        filtered = filtered.filter((item) => {
          const haystack = [
            item.id,
            item.title,
            item.summary,
            item.source,
            ...(item.acceptanceCriteria || []),
          ].join(' ').toLowerCase();
          return haystack.includes(query);
        });
      }

      return filtered;
    }

    function taskGroupLabel(key) {
      if (key === 'active') return 'いま進める Task';
      if (key === 'queued') return '次に回す Task';
      if (key === 'blocked') return '要対応で止まっている Task';
      return '完了した Task';
    }

    function renderTaskCard(item, currentTask, nextTask) {
      const criteria = (item.acceptanceCriteria || []).slice(0, 2);
      return \`
        <article class="task-item \${currentTask && currentTask.id === item.id ? 'current' : nextTask && nextTask.id === item.id ? 'next' : ''}">
          <div class="task-row">
            <div>
              <div class="task-id">\${escapeHtml(item.id)}</div>
              <div class="task-title">\${escapeHtml(item.title)}</div>
            </div>
            <div class="task-status \${escapeHtml(item.displayStatus)}">\${escapeHtml(taskStatusLabel(item.displayStatus))}</div>
          </div>
          <div class="task-summary">\${escapeHtml(item.summary || item.title)}</div>
          \${criteria.length > 0
            ? '<div class="criteria-list">' + criteria.map((criterion) => '<span class="criteria-pill">' + escapeHtml(criterion) + '</span>').join('') + '</div>'
            : ''}
          <div class="task-meta">
            <span class="priority-badge \${escapeHtml(item.priority)}">\${escapeHtml(priorityLabel(item.priority))}</span>
            <span class="tag">作成元: \${escapeHtml(item.source)}</span>
            \${currentTask && currentTask.id === item.id ? '<span class="tag">今やる Task</span>' : ''}
            \${nextTask && nextTask.id === item.id ? '<span class="tag">次にやる Task</span>' : ''}
            \${item.acceptanceCriteria && item.acceptanceCriteria.length > 2
              ? '<span class="tag">条件 ' + escapeHtml(item.acceptanceCriteria.length) + ' 件</span>'
              : ''}
          </div>
          <div class="task-recency">
            \${escapeHtml(item.displayStatus === 'completed' && item.completedAt ? '完了 ' + formatTime(item.completedAt) : '更新 ' + formatTime(item.updatedAt))}
          </div>
          <div class="task-actions">
            \${item.displayStatus !== 'completed'
              ? '<button type="button" class="btn-secondary task-front-button" data-task-id="' + escapeHtml(item.id) + '">最優先にする</button>'
              : ''}
            \${item.displayStatus !== 'completed'
              ? '<button type="button" class="btn-secondary task-back-button" data-task-id="' + escapeHtml(item.id) + '">後ろへ回す</button>'
              : ''}
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
      \`;
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

    function renderTaskFlow(currentTask, nextTask, status) {
      const el = document.getElementById('taskFlow');
      document.getElementById('pipelineMeta').textContent =
        status.activeTaskCount + ' 進行中 / ' + status.queuedTaskCount + ' 待機';

      el.innerHTML = [
        currentTask
          ? \`
            <article class="conversation-item question">
              <div class="conversation-id">現在の Task / \${escapeHtml(currentTask.id)}</div>
              <div class="conversation-text">\${escapeHtml(currentTask.title)}</div>
              <div class="conversation-meta">\${escapeHtml(currentTask.summary || currentTask.title)}</div>
              <div class="task-actions">
                <button
                  type="button"
                  class="btn-primary flow-complete-button"
                  data-task-id="\${escapeHtml(currentTask.id)}"
                >完了チェック</button>
                <button
                  type="button"
                  class="btn-secondary flow-task-button"
                  data-task-id="\${escapeHtml(currentTask.id)}"
                >Task 一覧で見る</button>
              </div>
            </article>
          \`
          : '<article class="conversation-item question"><div class="conversation-id">現在の Task</div><div class="conversation-text">まだありません</div><div class="conversation-meta">Task を 1 件追加すると、ここに最優先の作業が出ます。</div></article>',
        nextTask
          ? \`
            <article class="conversation-item answer">
              <div class="conversation-id">次の Task / \${escapeHtml(nextTask.id)}</div>
              <div class="conversation-text">\${escapeHtml(nextTask.title)}</div>
              <div class="conversation-meta">\${escapeHtml(nextTask.summary || nextTask.title)}</div>
              <div class="task-actions">
                <button
                  type="button"
                  class="btn-secondary flow-front-button"
                  data-task-id="\${escapeHtml(nextTask.id)}"
                >これを最優先にする</button>
                <button
                  type="button"
                  class="btn-secondary flow-task-button"
                  data-task-id="\${escapeHtml(nextTask.id)}"
                >Task 一覧で見る</button>
              </div>
            </article>
          \`
          : '<article class="conversation-item answer"><div class="conversation-id">次の Task</div><div class="conversation-text">まだありません</div><div class="conversation-meta">今の Task が固まったら、次に回す Task を追加できます。</div></article>',
      ].join('');
    }

    function renderTaskBoard(items, currentTask, nextTask) {
      const el = document.getElementById('taskBoard');
      const filtered = filterTaskItems(items, currentTask, nextTask);

      document.getElementById('taskMeta').textContent = filtered.length + ' / ' + items.length + ' 件';
      document.getElementById('taskBoardSummary').textContent =
        (taskFilter === 'focus'
          ? '現在と次の Task'
          : taskFilter === 'completed'
            ? '完了済み Task'
            : taskFilter === 'all'
              ? 'すべての Task'
              : '未完了 Task') +
        ' を ' + filtered.length + ' 件表示' +
        (taskSearchQuery ? ' / 検索: ' + taskSearchQuery : '');

      document.querySelectorAll('[data-task-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.taskFilter === taskFilter);
      });

      if (items.length === 0) {
        el.innerHTML = '<div class="empty">Task はまだありません</div>';
        return;
      }

      if (filtered.length === 0) {
        el.innerHTML = '<div class="empty">条件に合う Task はありません</div>';
        return;
      }

      const groupOrder = ['active', 'queued', 'blocked', 'completed'];
      const sections = groupOrder
        .map((groupKey) => ({
          key: groupKey,
          items: filtered.filter((item) => item.displayStatus === groupKey),
        }))
        .filter((group) => group.items.length > 0)
        .map((group) => \`
          <section class="list-section">
            <div class="list-section-title">\${escapeHtml(taskGroupLabel(group.key))} / \${escapeHtml(group.items.length)} 件</div>
            <div class="task-list">
              \${group.items.map((item) => renderTaskCard(item, currentTask, nextTask)).join('')}
            </div>
          </section>
        \`);

      el.innerHTML = sections.join('');
    }

    function renderConversation(pending, answered) {
      const el = document.getElementById('conversationList');
      document.getElementById('questionMeta').textContent = pending.length + ' 件待ち';
      document.getElementById('conversationSummary').textContent =
        pending.length > 0
          ? pending.length + ' 件の質問にいま回答できます。回答は次のターンに一度だけ差し込まれます。'
          : answered.length > 0
            ? '現在の確認待ちはありません。過去の回答は履歴として残しています。'
            : '確認待ちはありません。必要なら次ターン用のメモだけ残せます。';

      if (pending.length === 0 && answered.length === 0) {
        el.innerHTML = '<div class="empty">質問はまだありません</div>';
        return;
      }

      const pendingHtml = pending.map((item) => \`
        <article class="conversation-item question">
          <div class="conversation-id">\${escapeHtml(item.id)} / 回答待ち</div>
          <div class="conversation-text">\${escapeHtml(item.text)}</div>
          <div class="conversation-meta">\${formatTime(item.createdAt)}</div>
          <div class="task-actions">
            <button
              type="button"
              class="btn-primary quick-answer-button"
              data-question-id="\${escapeHtml(item.id)}"
            >この質問に答える</button>
            <button
              type="button"
              class="btn-secondary quick-copy-question-button"
              data-question-id="\${escapeHtml(item.id)}"
              data-question-text="\${escapeHtml(item.text)}"
            >内容を入力欄へ送る</button>
          </div>
        </article>
      \`).join('');

      const answeredHtml = answered.length > 0
        ? \`
          <details class="expander">
            <summary>
              <div class="list-section-title">回答済みの履歴 / \${escapeHtml(answered.length)} 件</div>
              <span class="expander-indicator">^</span>
            </summary>
            <div class="expander-body" style="padding: 12px 20px 20px;">
              <div class="conversation-list">
                \${answered.map((item) => \`
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
                \`).join('')}
              </div>
            </div>
          </details>
        \`
        : '';

      const sections = [];
      if (pendingHtml) {
        sections.push(\`
          <section class="list-section">
            <div class="list-section-title">いま答える質問</div>
            <div class="conversation-list">\${pendingHtml}</div>
          </section>
        \`);
      }
      if (answeredHtml) {
        sections.push(answeredHtml);
      }

      el.innerHTML = sections.join('');
    }

    function renderSignals(queue, blockers, events) {
      const signalEl = document.getElementById('signalList');
      const eventEl = document.getElementById('eventList');
      document.getElementById('signalMeta').textContent =
        blockers.length + ' 件の要対応 / ' + queue.length + ' 件の差し込み待ち';
      document.getElementById('signalSummary').textContent =
        blockers.length > 0
          ? blockers.length + ' 件の Blocker があります。ここを最優先で確認してください。'
          : queue.length > 0
            ? queue.length + ' 件が次ターンに差し込まれる待機状態です。'
            : '要対応も差し込み待ちもありません。';

      const sections = [];

      if (blockers.length > 0) {
        sections.push(\`
          <section class="list-section">
            <div class="list-section-title">まず確認する Blocker</div>
            <div class="signal-list">
              \${blockers.map((item) => \`
                <article class="signal-item" style="border-color:rgba(255,107,107,0.22);background:rgba(255,107,107,0.08);">
                  <div class="signal-id">\${escapeHtml(item.id)} / 要対応</div>
                  <div class="signal-text">\${escapeHtml(item.text)}</div>
                  <div class="signal-tags">
                    <span class="tag">作成元: \${escapeHtml(item.source)}</span>
                    <span class="tag">時刻: \${formatTime(item.createdAt)}</span>
                  </div>
                </article>
              \`).join('')}
            </div>
          </section>
        \`);
      }

      if (queue.length > 0) {
        sections.push(\`
          <section class="list-section">
            <div class="list-section-title">次ターンに差し込む情報</div>
            <div class="signal-list">
              \${queue.map((item) => \`
                <article class="signal-item">
                  <div class="signal-id">\${escapeHtml(item.id)} / \${escapeHtml(item.kind === 'answer' ? '回答' : 'メモ')}</div>
                  <div class="signal-text">\${escapeHtml(item.text)}</div>
                  <div class="signal-tags">
                    <span class="tag">対象: \${escapeHtml(item.label)}</span>
                    <span class="tag">時刻: \${formatTime(item.createdAt)}</span>
                  </div>
                </article>
              \`).join('')}
            </div>
          </section>
        \`);
      }

      signalEl.innerHTML = sections.length > 0
        ? sections.join('')
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
      const agentCommandInput = document.getElementById('settingsAgentCommand');
      const agentCommandHint = document.getElementById('settingsAgentCommandHint');

      document.getElementById('settingsMeta').textContent =
        '更新者: ' + sourceLabel(settings.updatedBy);
      document.getElementById('settingsPreview').textContent =
        (settings.mode === 'demo' ? 'デモ' : '通常実行') +
        ' / ' + settings.maxIterations + ' 回 / ' +
        (String(settings.promptBody || '').trim() ? '画面上書き prompt' : (settings.promptFile || 'prompt 未設定'));

      agentCommandInput.disabled = !runtimeCapabilities.canEditAgentCommand;
      agentCommandHint.textContent = runtimeCapabilities.canEditAgentCommand
        ? '通常実行で使うコマンドです。信頼できる運用だけで変更してください。'
        : '安全のため、agentCommand は起動時設定に固定しています。変更は CLI または環境変数から行います。';

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

    function renderOnboarding(data) {
      const section = document.getElementById('onboardingSection');
      const show =
        (data.taskBoard || []).length === 0 &&
        !data.currentTask &&
        !data.nextTask;

      section.style.display = show ? 'grid' : 'none';
    }

    async function refreshDashboard() {
      const response = await fetch('/api/dashboard');
      const data = await response.json();
      const status = data.status;
      latestDashboard = data;
      runtimeCapabilities = data.capabilities || { canEditAgentCommand: false };

      document.getElementById('heroTask').textContent = status.task || 'Ralph';
      document.getElementById('heroLifecycle').textContent = lifecycleLabel(status.lifecycle);
      document.getElementById('heroIteration').textContent = status.iteration + ' / ' + status.maxIterations;
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
        '状態: ' + phaseLabel(status.phase) + ' / 実行: ' + (status.mode === 'demo' ? 'デモ' : '通常実行');

      renderOnboarding(data);
      setThinkingFrames(data.thinkingFrames || [status.thinkingText || status.currentStatusText || 'Ralph が考えています...']);
      renderFocusSummary(data);
      renderQuickComposer(data);
      syncHeroControls(data);
      renderSettings(data.settings);
      renderAgentLanes(data.agentLanes || []);
      renderTaskFlow(data.currentTask, data.nextTask, status);
      renderTaskBoard(data.taskBoard || [], data.currentTask, data.nextTask);
      renderTaskImportPreview();
      renderConversation(data.pendingQuestions || [], data.answeredQuestions || []);
      renderSignals(data.promptInjectionQueue || [], data.blockers || [], data.recentEvents || []);
      document.getElementById('agentLog').textContent = (data.agentLogTail || []).join('\\n');
      document.getElementById('logMeta').textContent = (data.agentLogTail || []).filter(Boolean).length + ' 行';
    }

    window.setInterval(cycleThinkingFrame, 2200);
    window.setInterval(() => {
      refreshDashboard().catch((error) => console.error(error));
    }, 4000);

    refreshDashboard().catch((error) => console.error(error));
    renderTaskImportPreview();

    document.querySelectorAll('#settingsForm input, #settingsForm textarea, #settingsForm select').forEach((element) => {
      element.addEventListener('input', () => {
        settingsDirty = true;
      });
      element.addEventListener('change', () => {
        settingsDirty = true;
      });
    });

    document.getElementById('quickModeTabs').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest('[data-quick-mode]');
      if (!(button instanceof HTMLElement) || !button.dataset.quickMode) {
        return;
      }

      focusQuickComposer(button.dataset.quickMode);
    });

    document.getElementById('quickAnswerTarget').addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement) {
        syncQuickDraftFromInput('answer', quickAnswerId);
        quickAnswerId = target.value;
        const input = document.getElementById('quickInput');
        if (input instanceof HTMLTextAreaElement) {
          input.value = readQuickDraft('answer', quickAnswerId);
        }
        if (latestDashboard) {
          renderQuickComposer(latestDashboard);
        }
      }
    });

    document.getElementById('quickInput').addEventListener('input', () => {
      syncQuickDraftFromInput();
      renderQuickPreview(latestDashboard);
    });

    document.getElementById('quickInput').addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void sendQuickInput();
      }
    });

    document.getElementById('quickShortcuts').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest('[data-quick-shortcut]');
      if (!(button instanceof HTMLElement) || !button.dataset.quickShortcut) {
        return;
      }

      focusQuickComposer(button.dataset.quickShortcut);
    });

    document.getElementById('taskFilters').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest('[data-task-filter]');
      if (!(button instanceof HTMLElement) || !button.dataset.taskFilter) {
        return;
      }

      taskFilter = button.dataset.taskFilter;
      if (latestDashboard) {
        renderTaskBoard(
          latestDashboard.taskBoard || [],
          latestDashboard.currentTask,
          latestDashboard.nextTask,
        );
      }
    });

    document.getElementById('taskSearch').addEventListener('input', (event) => {
      const target = event.target;
      taskSearchQuery = target instanceof HTMLInputElement ? target.value.trim() : '';
      if (latestDashboard) {
        renderTaskBoard(
          latestDashboard.taskBoard || [],
          latestDashboard.currentTask,
          latestDashboard.nextTask,
        );
      }
    });

    document.getElementById('taskImportInput').addEventListener('input', () => {
      renderTaskImportPreview();
    });

    document.getElementById('conversationList').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const answerButton = target.closest('.quick-answer-button');
      if (answerButton instanceof HTMLElement && answerButton.dataset.questionId) {
        focusQuickComposer('answer', { questionId: answerButton.dataset.questionId });
        return;
      }

      const copyButton = target.closest('.quick-copy-question-button');
      if (copyButton instanceof HTMLElement) {
        focusQuickComposer('answer', {
          questionId: copyButton.dataset.questionId || '',
          prefill: copyButton.dataset.questionText || '',
        });
      }
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

      const frontButton = target.closest('.task-front-button');
      if (frontButton instanceof HTMLElement && frontButton.dataset.taskId) {
        void moveTask(frontButton.dataset.taskId, 'front');
        return;
      }

      const backButton = target.closest('.task-back-button');
      if (backButton instanceof HTMLElement && backButton.dataset.taskId) {
        void moveTask(backButton.dataset.taskId, 'back');
        return;
      }

      const reopenButton = target.closest('.task-reopen-button');
      if (reopenButton instanceof HTMLElement && reopenButton.dataset.taskId) {
        void reopenTask(reopenButton.dataset.taskId);
      }
    });

    document.getElementById('taskFlow').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const completeButton = target.closest('.flow-complete-button');
      if (completeButton instanceof HTMLElement && completeButton.dataset.taskId) {
        void completeTask(completeButton.dataset.taskId);
        return;
      }

      const frontButton = target.closest('.flow-front-button');
      if (frontButton instanceof HTMLElement && frontButton.dataset.taskId) {
        void moveTask(frontButton.dataset.taskId, 'front');
        return;
      }

      const taskButton = target.closest('.flow-task-button');
      if (taskButton instanceof HTMLElement && taskButton.dataset.taskId) {
        focusSection('taskSection');
        const board = document.getElementById('taskBoard');
        if (board instanceof HTMLElement) {
          board.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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
    try {
      if (!isAuthorized(request, config)) {
        writeUnauthorized(response);
        return;
      }

      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        writeJson(response, 200, await actions.getDashboardData());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/start') {
        writeJson(response, 200, await actions.requestRunStart({ source: 'web' }));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/settings') {
        const body = await readJsonBody(request);
        try {
          writeJson(
            response,
            200,
            await actions.updateRuntimeSettings(
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
            ),
          );
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : '設定を更新できませんでした');
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/pause') {
        writeJson(response, 200, await actions.pauseRun({ source: 'web' }));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/resume') {
        writeJson(response, 200, await actions.resumeRun({ source: 'web' }));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/abort') {
        const data = await actions.abortRun({ source: 'web' });
        hooks.onAbort?.();
        writeJson(response, 200, data);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/answer') {
        const body = await readJsonBody(request);
        if (typeof body.questionId !== 'string' || typeof body.answer !== 'string' || !body.questionId || !body.answer) {
          throw new HttpError(400, '質問IDと回答の両方が必要です');
        }

        writeJson(response, 200, await actions.submitAnswer(body.questionId, body.answer, { source: 'web' }));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/note') {
        const body = await readJsonBody(request);
        if (typeof body.note !== 'string' || !body.note) {
          throw new HttpError(400, 'メモを入力してください');
        }

        await actions.enqueueManualNote(body.note, { source: 'web' });
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/task/import/preview') {
        const body = await readJsonBody(request);
        if (typeof body.specText !== 'string' || !body.specText.trim()) {
          throw new HttpError(400, '仕様書を貼り付けてください');
        }

        writeJson(response, 200, await actions.previewTaskImport(body.specText));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/task/import') {
        try {
          const body = await readJsonBody(request);
          if (typeof body.specText !== 'string' || !body.specText.trim()) {
            throw new HttpError(400, '仕様書を貼り付けてください');
          }

          writeJson(response, 200, await actions.importTasksFromSpec(body.specText, { source: 'web' }));
        } catch (error) {
          if (error instanceof HttpError) {
            throw error;
          }
          throw new HttpError(400, error instanceof Error ? error.message : 'Task を一括追加できませんでした');
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/task/create') {
        try {
          const body = await readJsonBody(request);
          writeJson(
            response,
            200,
            await actions.createTask(
              {
                title: typeof body.title === 'string' ? body.title : undefined,
                summary: typeof body.summary === 'string' ? body.summary : undefined,
              },
              { source: 'web' },
            ),
          );
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : 'Task を作成できませんでした');
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/task/update') {
        const body = await readJsonBody(request);
        if (typeof body.taskId !== 'string' || !body.taskId) {
          throw new HttpError(400, '更新対象のTask IDが必要です');
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
          throw new HttpError(404, '指定した Task が見つかりません');
        }

        writeJson(response, 200, data);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/task/complete') {
        const body = await readJsonBody(request);
        if (typeof body.taskId !== 'string' || !body.taskId) {
          throw new HttpError(400, '完了にするTask IDが必要です');
        }

        const data = await actions.completeTask(body.taskId, { source: 'web' });
        if (!data) {
          throw new HttpError(404, '指定した Task が見つかりません');
        }

        writeJson(response, 200, data);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/task/reopen') {
        const body = await readJsonBody(request);
        if (typeof body.taskId !== 'string' || !body.taskId) {
          throw new HttpError(400, '戻すTask IDが必要です');
        }

        const data = await actions.reopenTask(body.taskId, { source: 'web' });
        if (!data) {
          throw new HttpError(404, '指定した Task が見つかりません');
        }

        writeJson(response, 200, data);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/task/move') {
        const body = await readJsonBody(request);
        if (typeof body.taskId !== 'string' || !body.taskId) {
          throw new HttpError(400, '並び替えるTask IDが必要です');
        }
        if (body.position !== 'front' && body.position !== 'back') {
          throw new HttpError(400, 'position は front または back で指定してください');
        }

        const data = await actions.moveTask(body.taskId, body.position, { source: 'web' });
        if (!data) {
          throw new HttpError(404, '指定した Task が見つかりません');
        }

        writeJson(response, 200, data);
        return;
      }

      throw new HttpError(404, 'ページが見つかりません');
    } catch (error) {
      writeError(response, error);
    }
  });

  server.listen(config.panelPort, config.panelHost, () => {
    console.log(`panel: http://${config.panelHost}:${config.panelPort}`);
  });

  return server;
}
