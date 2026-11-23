import { describe, it, expect } from 'vitest';
import { QUESTIONS, THEMES, DEPTHS, randomIndex, createSession, transition, available, validateSession } from '../../src/domain/game';
const fresh = () => createSession('test', 'session', '2026-11-22T00:00:00Z');
describe('Случайность', () => {
  it('даёт каждому элементу равный интервал, включая n=1', () => {
    for (let n=1;n<=60;n++) {
      expect(Array.from({length:n},(_,i)=>randomIndex(n,()=>(i+.5)/n))).toEqual(Array.from({length:n},(_,i)=>i));
      expect(randomIndex(n,()=>0)).toBe(0);
      expect(randomIndex(n,()=>1-Number.EPSILON)).toBe(n-1);
    }
  });
  it('отклоняет неверные границы', () => {
    for (const value of [-.01,1,NaN,Infinity]) expect(()=>randomIndex(6,()=>value)).toThrow();
    expect(()=>randomIndex(0)).toThrow();
  });
});
describe('Жизненный цикл игры', () => {
  it('все 60 карточек можно показать без повторов между сочетаниями', () => {
    let s=fresh(); const drawn:string[]=[];
    for (const theme of THEMES) {
      s=transition(s,{type:'change'});
      s=transition(s,{type:'theme',value:theme.id});
      s=transition(s,{type:'continue'});

      s=transition(s,{type:'continue'},()=>0);
      while(s.phase==='question') {
        drawn.push(s.currentQuestionId!);s=transition(s,{type:'next'},()=>0);
      }
      expect(available(s)).toHaveLength(0);
    }
    expect(drawn).toHaveLength(60);expect(new Set(drawn).size).toBe(60);
    expect(new Set(drawn)).toEqual(new Set(QUESTIONS.map(q=>q.id)));
    expect(s.shownIds).toHaveLength(60);
  });
  it('последняя карточка остаётся открытой; затем тема недоступна', () => {
    let s=transition(fresh(),{type:'theme',value:'childhood'});
    s=transition(s,{type:'continue'});
    for(let i=0;i<10;i++) {
      expect(s.phase).toBe('depth');
      s=transition(s,{type:'draw',index:0},()=>0);
      expect(s.phase).toBe('question');
      expect(s.shownIds).toHaveLength(i+1);
      validateSession(s);
      s=transition(s,{type:'layout'});
    }
    expect(s.phase).toBe('exhausted');
    s=transition(s,{type:'change'});
    expect(()=>transition(s,{type:'theme',value:'childhood'})).toThrow();
  });
  it('выбор из рубашек и случайный выбор охватывают все уровни с равными шансами', () => {
    let s=transition(fresh(),{type:'theme',value:'childhood'});
    s=transition(s,{type:'continue'});
    const pool=available(s);
    for(let i=0;i<pool.length;i++) {
      const drawn=transition(s,{type:'draw'},()=>(i+.5)/pool.length);
      expect(drawn.currentQuestionId).toBe(pool[i].id);
    }
    expect(new Set(pool.map(q=>q.depth)).size).toBe(3);
    expect(()=>transition(s,{type:'draw',index:10})).toThrow();
  });
  it('выбор темы и глубины не расходует карточки и не зависит от исчерпания', () => {
    let s=fresh();
    for (const theme of THEMES) s=transition(s,{type:'theme',value:theme.id});
    expect(s.shownIds).toEqual([]);
    s=transition(s,{type:'continue'});
    for(const d of DEPTHS)s=transition(s,{type:'depth',value:d.value});
    expect(s.shownIds).toEqual([]);
    expect(THEMES).toHaveLength(6);expect(DEPTHS).toHaveLength(3);
  });
  it('не начинает игру без выбора и не принимает повреждённые снимки', () => {
    expect(()=>transition(fresh(),{type:'continue'})).toThrow();
    for(const wrong of [
      {...fresh(),schemaVersion:999}, {...fresh(),shownIds:['q001','q001']},
      {...fresh(),shownIds:['unknown']}, {...fresh(),phase:'question'},
      {...fresh(),depth:2}, {...fresh(),themeId:'bad'}, {...fresh(),revision:-1},
    ]) expect(()=>validateSession(wrong)).toThrow();
  });
  it('новая игра делает карточки доступными, старую не меняет', () => {
    const s=fresh();const another=createSession('test','other');
    expect(another.sessionId).not.toBe(s.sessionId);expect(another.shownIds).toEqual([]);
  });
});
