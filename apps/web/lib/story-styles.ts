export const STORY_STYLES = [
  { id: 'natural', title: 'Сохранить мой голос', instruction: 'Сохрани лексику, интонацию, паузы и позицию Автора; исправь только очевидные ошибки формы.' },
  { id: 'literary', title: 'Литературно и связно', instruction: 'Улучши переходы и композицию только на основании рассказанного; не добавляй сцены, причины или выводы.' },
  { id: 'warm', title: 'Тепло и образно', instruction: 'Подчеркни уже названные Автором детали; не придумывай эмоции, ощущения, метафорические события или диалоги.' },
  { id: 'concise', title: 'Кратко и ясно', instruction: 'Убери речевой шум и повторы, сохрани все уникальные факты, сомнения и значимые детали.' },
  { id: 'chronological', title: 'Хронологично', instruction: 'Упорядочи только явно установленную последовательность событий; неизвестные даты и связи не угадывай.' },
] as const;
export type NarrativeStyle = typeof STORY_STYLES[number]['id'];
export function isNarrativeStyle(value: unknown): value is NarrativeStyle { return STORY_STYLES.some(style => style.id === value); }
export function styleInstruction(style: NarrativeStyle = 'natural') { return STORY_STYLES.find(option => option.id === style)!.instruction; }
