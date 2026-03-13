import type { AnswerRecord, ManualNoteRecord, PromptCompositionResult } from '../shared/types.ts';

function renderAnswers(answers: AnswerRecord[]): string | null {
  if (answers.length === 0) {
    return null;
  }

  const lines = answers.map((answer) => `- ${answer.questionId}: ${answer.answer}`);
  return ['先ほどの質問の答えが届きました:', ...lines].join('\n');
}

function renderNotes(notes: ManualNoteRecord[]): string | null {
  if (notes.length === 0) {
    return null;
  }

  const lines = notes.map((note) => `- ${note.id}: ${note.note}`);
  return ['追加の運用メモが届きました:', ...lines].join('\n');
}

export function composePromptWithInjections(
  basePrompt: string,
  answers: AnswerRecord[],
  notes: ManualNoteRecord[],
  extraSections: string[] = [],
): PromptCompositionResult {
  const sections = [
    ...extraSections.filter(Boolean),
    renderAnswers(answers),
    renderNotes(notes),
  ].filter(Boolean) as string[];
  if (sections.length === 0) {
    return {
      prompt: basePrompt,
      injectedAnswerIds: [],
      injectedNoteIds: [],
      appendedSections: [],
    };
  }

  const prompt = `${basePrompt.trimEnd()}\n\n---\n${sections.join('\n\n')}\n`;
  return {
    prompt,
    injectedAnswerIds: answers.map((answer) => answer.id),
    injectedNoteIds: notes.map((note) => note.id),
    appendedSections: sections,
  };
}
