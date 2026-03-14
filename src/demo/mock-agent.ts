export async function runMockAgent(prompt: string, iteration: number): Promise<string> {
  const lines: string[] = [];

  if (iteration === 1) {
    lines.push('[[THINKING]] PRD を読み込み、task graph と worker lane を割り当てています');
    lines.push('[[TASK]] US-001 | pending | Rustプロジェクト初期化と基本セットアップ');
    lines.push('[[TASK]] US-002 | pending | 引数解析の追加');
    lines.push('[[STATUS]] demo mode: supervisor と panel の初期実装を進めています');
    lines.push('[[QUESTION]] staging と production のどちらを優先すべきですか？未回答でも Web panel 実装は続行します。');
    lines.push('[[STATUS]] 質問を投げましたが、回答待ちで停止せず panel 実装を継続します');
    return `${lines.join('\n')}\n`;
  }

  if (prompt.includes('Q-001:') || prompt.includes('staging を優先')) {
    lines.push('[[THINKING]] 受領した回答を task graph と次ターンの統合順に反映しています');
    lines.push('[[TASK]] US-001 | completed | Rustプロジェクト初期化と基本セットアップ');
    lines.push('[[STATUS]] 回答を受領したため設定優先度を更新します');
    lines.push('[[DONE]] demo mode: 質問回答の prompt 注入を確認できたので完了します');
    return `${lines.join('\n')}\n`;
  }

  lines.push('[[THINKING]] 人間の返答を待ちながら、未依存の作業レーンを進めています');
  lines.push('[[STATUS]] まだ回答は届いていません。返答待ちにせず、実装とテストを続行しています');
  if (iteration === 2) {
    lines.push('[[TASK]] US-002 | pending | 引数解析の追加');
    lines.push('[[BLOCKER]] Discord token が未設定なら通知確認は Web panel と logs で代替してください');
  }

  return `${lines.join('\n')}\n`;
}
