import deck from '../content/deck.json';
export const DECK_VERSION = deck.deckVersion;
export const THEMES = [
  { id: 'childhood', label: 'Детство и воспоминания', short: 'Детство', color: '#789887', light: '#E2EAE3', symbol: '☀' },
  { id: 'self', label: 'Я и моя жизнь', short: 'О себе', color: '#D9A79A', light: '#E2EAE3', symbol: '✦' },
  { id: 'relationships', label: 'Отношения', short: 'Близость', color: '#29352F', light: '#E2EAE3', symbol: '♡' },
  { id: 'dreams', label: 'Мечты и желания', short: 'Мечты', color: '#D9A79A', light: '#E2EAE3', symbol: '✧' },
  { id: 'meanings', label: 'Ценности и смыслы', short: 'О важном', color: '#789887', light: '#E2EAE3', symbol: '❋' },
  { id: 'unexpected', label: 'Неожиданные вопросы', short: 'Сюрприз', color: '#29352F', light: '#E2EAE3', symbol: '☄' },
] as const;
export const DEPTHS = [
  { value: 1, label: 'Лёгкий', description: 'Воспоминания, воображение и маленькие радости', color: '#29352F', light: '#F7F4EE' },
  { value: 2, label: 'Исследовательский', description: 'Личный опыт и неожиданные открытия', color: '#789887', light: '#F7F4EE' },
  { value: 3, label: 'Глубокий', description: 'Чувства, ценности и то, что особенно важно', color: '#789887', light: '#F7F4EE' },
] as const;
export type ThemeId = typeof THEMES[number]['id'];
export type Depth = 1 | 2 | 3;
export type Phase = 'theme' | 'depth' | 'question' | 'exhausted';
export interface Question { id: string; displayNumber: number; text: string; themeId: string; depth: number; sourceRow: number }
export const QUESTIONS: Question[] = deck.questions;
export interface Session {
  schemaVersion: 1; deckVersion: string; buildId: string; sessionId: string; revision: number;
  startedAt: string; updatedAt: string; phase: Phase; themeId: ThemeId | null; depth: Depth | null;
  currentQuestionId: string | null; shownIds: string[];
}
export type Action = { type: 'theme'; value: ThemeId } | { type: 'depth'; value: Depth }
  | { type: 'draw'; index?: number } | { type: 'layout' } | { type: 'continue' } | { type: 'next' } | { type: 'change' } | { type: 'back' };
export function randomIndex(count: number, random: () => number = Math.random): number {
  const value = random();
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Неверный случайный выбор');
  return Math.floor(value * count);
}
export function createSession(buildId: string, id: string, now = new Date().toISOString()): Session {
  return { schemaVersion: 1, deckVersion: DECK_VERSION, buildId, sessionId: id, revision: 0,
    startedAt: now, updatedAt: now, phase: 'theme', themeId: null, depth: null, currentQuestionId: null, shownIds: [] };
}
export function available(s: Session): Question[] {
  return QUESTIONS.filter(q => q.themeId === s.themeId && !s.shownIds.includes(q.id));
}
export function themeAvailable(s: Session | undefined, id: ThemeId): boolean { return QUESTIONS.some(q => q.themeId === id && !s?.shownIds.includes(q.id)); }
export function transition(s: Session, action: Action, random = Math.random): Session {
  validateSession(s);
  const next = { ...s, shownIds: [...s.shownIds], revision: s.revision + 1, updatedAt: new Date().toISOString() };
  const draw = (index?: number) => {
    const choices = available(next);
    if (!choices.length) { next.phase = 'exhausted'; next.currentQuestionId = null; return; }
    if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= choices.length)) throw new Error('Неизвестная карточка');
    const q = choices[randomIndex(choices.length, random)];
    next.depth = q.depth as Depth;
    next.phase = 'question'; next.currentQuestionId = q.id; next.shownIds.push(q.id);
  };
  switch (action.type) {
    case 'theme':
      if (s.phase !== 'theme' || !THEMES.some(t => t.id === action.value) || !themeAvailable(s, action.value)) throw new Error('Выбери тему');
      next.themeId = action.value; break;
    case 'depth':
      if (s.phase !== 'depth' || ![1,2,3].includes(action.value)) throw new Error('Выбери глубину');
      next.depth = action.value; break;
    case 'continue':
      if (s.phase === 'theme' && s.themeId) next.phase = 'depth';
      else if (s.phase === 'depth') draw();
      else throw new Error('Сначала сделай выбор');
      break;
    case 'draw':
      if (s.phase !== 'depth') throw new Error('Открой раскладку');
      draw(action.index); break;
    case 'layout':
      if (s.phase !== 'question') throw new Error('Карточка не открыта');
      next.currentQuestionId = null; next.depth = null;
      next.phase = available(next).length ? 'depth' : 'exhausted'; break;
    case 'next':
      if (s.phase !== 'question') throw new Error('Карточка не открыта');
      draw(); break;
    case 'change': case 'back':
      next.phase = 'theme'; next.depth = null; next.currentQuestionId = null; break;
  }
  validateSession(next);
  return next;
}
export function validateSession(input: unknown): asserts input is Session {
  const s = input as Session;
  if (!s || s.schemaVersion !== 1 || s.deckVersion !== DECK_VERSION || typeof s.buildId !== 'string' || !s.buildId
      || typeof s.sessionId !== 'string' || !s.sessionId || !Number.isInteger(s.revision) || s.revision < 0
      || !Number.isFinite(Date.parse(s.startedAt)) || !Number.isFinite(Date.parse(s.updatedAt))
      || !['theme','depth','question','exhausted'].includes(s.phase)
      || (s.themeId !== null && !THEMES.some(t => t.id === s.themeId))
      || (s.depth !== null && ![1,2,3].includes(s.depth))
      || !Array.isArray(s.shownIds) || new Set(s.shownIds).size !== s.shownIds.length
      || s.shownIds.some(id => !QUESTIONS.some(q => q.id === id))) throw new Error('Не удалось прочитать сохранённую игру');
  if (s.phase === 'theme' && (s.depth !== null || s.currentQuestionId !== null)) throw new Error('Повреждён выбор темы');
  if (s.phase !== 'theme' && !s.themeId) throw new Error('Неизвестная тема');
  if (s.phase === 'depth' && s.currentQuestionId !== null) throw new Error('Повреждён выбор глубины');
  if (s.phase === 'question' && !s.depth) throw new Error('Неизвестная глубина');
  if (s.phase === 'question') {
    const q = QUESTIONS.find(q => q.id === s.currentQuestionId);
    if (!q || !s.shownIds.includes(q.id) || q.themeId !== s.themeId || q.depth !== s.depth) throw new Error('Неизвестный вопрос');
  }
  if (s.phase === 'exhausted' && (s.currentQuestionId !== null || available(s).length)) throw new Error('Повреждена история вопросов');
}
