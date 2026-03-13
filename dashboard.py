#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
import urllib.parse

ROOT = Path(__file__).resolve().parent
STATUS_PATH = ROOT / "status.json"
PROGRESS_PATH = ROOT / "progress.txt"
QUESTIONS_PATH = ROOT / "questions.log"
ANSWERS_PATH = ROOT / "answers.txt"
EVENTS_PATH = ROOT / "events.log"


def read_text(path: Path, default: str = "") -> str:
    if not path.exists():
        return default
    return path.read_text(encoding="utf-8", errors="ignore")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: str, content_type: str = "text/html; charset=utf-8"):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path == "/api/status":
            payload = {
                "status": json.loads(read_text(STATUS_PATH, "{}") or "{}"),
                "progressTail": "\n".join(read_text(PROGRESS_PATH).splitlines()[-30:]),
                "questionsTail": "\n".join(read_text(QUESTIONS_PATH).splitlines()[-30:]),
                "eventsTail": "\n".join(read_text(EVENTS_PATH).splitlines()[-60:]),
            }
            self._send(200, json.dumps(payload, ensure_ascii=False), "application/json; charset=utf-8")
            return

        html = """<!doctype html>
<html lang=\"ja\"><head><meta charset=\"utf-8\"><title>Ralph パネル</title>
<style>
body { font-family: sans-serif; margin: 20px; }
.card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
pre { background: #111; color: #d9f99d; padding: 10px; border-radius: 6px; overflow:auto; max-height: 280px; }
button { padding: 8px 12px; margin-right: 8px; }
input { width: 70%; padding: 8px; }
</style></head><body>
<h2>Ralph 進捗パネル</h2>
<div class=\"card\">
  <button onclick=\"refreshNow()\">更新</button>
  <span id=\"meta\"></span>
</div>
<div class=\"card\"><h3>ステータス</h3><pre id=\"status\">読み込み中...</pre></div>
<div class=\"card\"><h3>progress.txt（末尾）</h3><pre id=\"progress\"></pre></div>
<div class=\"card\"><h3>通知ログ（events.log / Discordなしでもここで確認可能）</h3><pre id=\"events\"></pre></div>
<div class=\"card\"><h3>AIからの質問ログ（questions.log）</h3><pre id=\"questions\"></pre></div>
<div class=\"card\"><h3>回答を送る（answers.txtに追記）</h3>
  <input id=\"ans\" placeholder=\"例: APIキーは staging を使ってください\" />
  <button onclick=\"sendAnswer()\">回答を送信</button>
</div>
<script>
async function refreshNow(){
  const res = await fetch('/api/status');
  const data = await res.json();
  document.getElementById('status').textContent = JSON.stringify(data.status, null, 2);
  document.getElementById('progress').textContent = data.progressTail || '(なし)';
  document.getElementById('events').textContent = data.eventsTail || '(なし)';
  document.getElementById('questions').textContent = data.questionsTail || '(なし)';
  document.getElementById('meta').textContent = '最終更新: ' + new Date().toLocaleString();
}
async function sendAnswer(){
  const text = document.getElementById('ans').value.trim();
  if(!text){ return; }
  await fetch('/api/answer', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'text=' + encodeURIComponent(text)});
  document.getElementById('ans').value='';
  refreshNow();
}
setInterval(refreshNow, 5000);
refreshNow();
</script></body></html>"""
        self._send(200, html)

    def do_POST(self):
        if self.path != "/api/answer":
            self._send(404, "not found", "text/plain; charset=utf-8")
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8", errors="ignore")
        params = urllib.parse.parse_qs(body)
        text = (params.get("text") or [""])[0].strip()
        if text:
            with ANSWERS_PATH.open("a", encoding="utf-8") as f:
                f.write(text + "\n")
        self._send(200, "ok", "text/plain; charset=utf-8")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8787), Handler)
    print("Ralph パネル: http://localhost:8787")
    server.serve_forever()
