#!/bin/bash
set -euo pipefail

# 設定値
MAX_ITERATIONS=${MAX_ITERATIONS:-10}
SLEEP_SECONDS=${SLEEP_SECONDS:-2}
SHOW_PROGRESS_LINES=${SHOW_PROGRESS_LINES:-5}
AI_OUTPUT_PREFIX=${AI_OUTPUT_PREFIX:-"🤖 AI> "}
DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL:-""}
STATUS_FILE=${STATUS_FILE:-"status.json"}
ANSWER_FILE=${ANSWER_FILE:-"answers.txt"}
ANSWER_OFFSET_FILE=${ANSWER_OFFSET_FILE:-".answers.offset"}
EVENT_LOG_FILE=${EVENT_LOG_FILE:-"events.log"}
AGENT_CMD="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$AGENT_CMD" ]; then
  echo "使い方: ./ralph-loop/ralph.sh \"<agent command>\" [最大反復回数]"
  echo "例: ./ralph-loop/ralph.sh \"codex exec --full-auto\" 20"
  echo "環境変数:"
  echo "  MAX_ITERATIONS (既定: 10)"
  echo "  SLEEP_SECONDS (既定: 2)"
  echo "  SHOW_PROGRESS_LINES (既定: 5)"
  echo "  AI_OUTPUT_PREFIX (既定: 🤖 AI> )"
  echo "  DISCORD_WEBHOOK_URL (任意: Discord通知先)"
  echo "  STATUS_FILE (既定: status.json)"
  echo "  ANSWER_FILE (既定: answers.txt)"
  echo "  EVENT_LOG_FILE (既定: events.log)"
  exit 1
fi

if [ -n "${2:-}" ]; then
  MAX_ITERATIONS=$2
fi

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

send_discord_notification() {
  local message="$1"
  if [ -z "$DISCORD_WEBHOOK_URL" ]; then
    return
  fi

  local payload
  payload=$(python3 - <<'PY' "$message"
import json, sys
print(json.dumps({"content": sys.argv[1]}, ensure_ascii=False))
PY
)

  curl -sS -X POST "$DISCORD_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "$payload" >/dev/null || true
}

notify() {
  local message="$1"
  local ts
  ts=$(timestamp)

  echo "[$ts] $message" | tee -a "$SCRIPT_DIR/$EVENT_LOG_FILE"
  send_discord_notification "$message"
}

get_story_counts() {
  python3 - "$SCRIPT_DIR/prd.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.exists():
    print("0|0|0|-")
    raise SystemExit(0)

try:
    data = json.loads(path.read_text(encoding='utf-8'))
except Exception:
    print("0|0|0|-")
    raise SystemExit(0)

stories = data.get('userStories') or []
p = len([s for s in stories if s.get('passes') is True])
r = len([s for s in stories if s.get('passes') is not True])
next_story = '-'
for s in stories:
    if s.get('passes') is not True:
        next_story = s.get('id', '-')
        break
print(f"{p}|{r}|{len(stories)}|{next_story}")
PY
}

write_status_json() {
  local phase="$1"
  local iteration="$2"
  local last_question="$3"
  local last_answer="$4"

  IFS='|' read -r passed remaining total next_story <<< "$(get_story_counts)"

  python3 - <<'PY' \
    "$SCRIPT_DIR/$STATUS_FILE" \
    "$(timestamp)" \
    "$phase" \
    "$iteration" \
    "$MAX_ITERATIONS" \
    "$passed" \
    "$remaining" \
    "$total" \
    "$next_story" \
    "$last_question" \
    "$last_answer"
import json
import sys
from pathlib import Path

(
    status_path,
    ts,
    phase,
    iteration,
    max_iterations,
    passed,
    remaining,
    total,
    next_story,
    last_question,
    last_answer,
) = sys.argv[1:]

payload = {
    "updatedAt": ts,
    "phase": phase,
    "iteration": int(iteration),
    "maxIterations": int(max_iterations),
    "stories": {
        "passed": int(passed),
        "remaining": int(remaining),
        "total": int(total),
        "next": next_story,
    },
    "lastQuestion": last_question,
    "lastAnswer": last_answer,
}

Path(status_path).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
PY
}

print_status_summary() {
  IFS='|' read -r passed remaining total next_story <<< "$(get_story_counts)"
  echo "📋 ストーリー進捗: 完了 $passed/$total | 残り $remaining | 次: $next_story"
}

print_recent_progress() {
  if [ ! -f "$SCRIPT_DIR/progress.txt" ]; then
    echo "📝 progress.txt はまだ作成されていません"
    return
  fi

  echo "📝 最新メモ（直近 $SHOW_PROGRESS_LINES 行）:"
  tail -n "$SHOW_PROGRESS_LINES" "$SCRIPT_DIR/progress.txt" | sed 's/^/   /'
}

append_new_answers_to_prompt() {
  local base_prompt="$1"
  local current_offset=0
  local total_lines=0

  [ -f "$SCRIPT_DIR/$ANSWER_FILE" ] || {
    echo "$base_prompt"
    return
  }

  if [ -f "$SCRIPT_DIR/$ANSWER_OFFSET_FILE" ]; then
    current_offset=$(cat "$SCRIPT_DIR/$ANSWER_OFFSET_FILE" 2>/dev/null || echo 0)
  fi

  total_lines=$(wc -l < "$SCRIPT_DIR/$ANSWER_FILE" | tr -d ' ')
  if [ "$total_lines" -le "$current_offset" ]; then
    echo "$base_prompt"
    return
  fi

  local new_answers
  new_answers=$(tail -n $((total_lines - current_offset)) "$SCRIPT_DIR/$ANSWER_FILE")
  echo "$total_lines" > "$SCRIPT_DIR/$ANSWER_OFFSET_FILE"

  cat <<EOF_PROMPT
$base_prompt

---
先ほどの質問の回答が届きました。以下を踏まえて作業を続けてください。
$new_answers
EOF_PROMPT
}

extract_question_from_output() {
  local output="$1"
  python3 - <<'PY' "$output"
import re
import sys

text = sys.argv[1]
matches = re.findall(r"<question>(.*?)</question>", text, flags=re.DOTALL)
if matches:
    print(matches[-1].strip())
PY
}

run_agent_and_capture() {
  local prompt_content="$1"
  local output_file="$2"

  printf "%s" "$prompt_content" | bash -lc "$AGENT_CMD" 2>&1 \
    | tee "$output_file" \
    | sed "s/^/${AI_OUTPUT_PREFIX}/"
}

echo "🚀 Ralphを開始します"
echo "🧠 エージェントコマンド: '$AGENT_CMD'"
echo "📂 作業ディレクトリ: $(pwd)"
echo "📁 スクリプト配置: $SCRIPT_DIR"
echo "🔄 最大反復回数: $MAX_ITERATIONS"
echo "⏱️ 反復間スリープ: ${SLEEP_SECONDS}秒"
echo "🏷️ AI出力プレフィックス: $AI_OUTPUT_PREFIX"

last_question=""
last_answer=""

write_status_json "starting" 0 "$last_question" "$last_answer"
notify "🚀 Ralph開始: max=${MAX_ITERATIONS}, cmd=${AGENT_CMD}"

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo ""
  echo "═══ 反復 $i/$MAX_ITERATIONS | $(timestamp) ═══"

  write_status_json "running" "$i" "$last_question" "$last_answer"

  print_status_summary
  print_recent_progress

  BASE_PROMPT=$(cat "$SCRIPT_DIR/prompt.md")
  PROMPT_CONTENT=$(append_new_answers_to_prompt "$BASE_PROMPT")

  if [ -f "$SCRIPT_DIR/$ANSWER_FILE" ]; then
    last_answer=$(tail -n 1 "$SCRIPT_DIR/$ANSWER_FILE" 2>/dev/null || true)
  fi

  echo "🤖 AIエージェントを実行します..."
  iteration_start=$(date +%s)
  OUTPUT_FILE=$(mktemp)

  run_agent_and_capture "$PROMPT_CONTENT" "$OUTPUT_FILE" || true
  OUTPUT=$(cat "$OUTPUT_FILE")
  rm -f "$OUTPUT_FILE"

  iteration_end=$(date +%s)
  echo "⏱️ 反復処理時間: $((iteration_end - iteration_start))秒"

  question=$(extract_question_from_output "$OUTPUT")
  if [ -n "$question" ]; then
    last_question="$question"
    notify "❓ AIから質問を検知: ${question}"
    echo "[$(timestamp)] $question" >> "$SCRIPT_DIR/questions.log"
    write_status_json "waiting_answer_but_continuing" "$i" "$last_question" "$last_answer"
  fi

  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo "✅ 完了: すべてのストーリーが終了しました"
    print_status_summary
    write_status_json "completed" "$i" "$last_question" "$last_answer"
    notify "✅ Ralph完了: iteration=${i}"
    exit 0
  fi

  if [ "$i" -lt "$MAX_ITERATIONS" ]; then
    echo "⏳ 反復 $i が終了。${SLEEP_SECONDS}秒待機します..."
    sleep "$SLEEP_SECONDS"
  fi
done

echo "⚠️ 最大反復回数に到達しました（完了シグナル未検知）"
print_status_summary
write_status_json "max_iterations_reached" "$MAX_ITERATIONS" "$last_question" "$last_answer"
notify "⚠️ Ralph終了: max iterations reached"
exit 1
