import './ui/style.css';
import { THEMES, DEPTHS, QUESTIONS, createSession, transition, validateSession, randomIndex, type Session, type Action, type ThemeId, type Depth } from './domain/game';
import { readRaw, commitRaw, fingerprint } from './storage/database';

const app = document.querySelector<HTMLDivElement>('#app')!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
let session: Session | undefined;
let key = fingerprint({});
let resume = false, invalid = false, ended = false, busy = false, spinning = false;
let error = '', offline = 'Готовим игру для работы без интернета', ready = false, update = false;
let pending: { candidate?: Session; after: () => void } | null = null;
let registration: ServiceWorkerRegistration | undefined;
let offlinePreparing = false;
let lastDraw = -Infinity;
const sync = 'BroadcastChannel' in window ? new BroadcastChannel(__DB_NAME__) : null;
const dialog = document.createElement('dialog');
document.body.append(dialog);

function release(s: Session | undefined) { return s ? { formatVersion: 1, sessionId: s.sessionId, buildId: s.buildId } : undefined; }
function button(label: string, action: string, cls = 'secondary', disabled = false) {
  return '<button class="' + cls + '" data-action="' + action + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
}
function fresh() { return createSession(__BUILD_ID__, crypto.randomUUID()); }
function render() {
  const phase = session?.phase || 'theme';
  const theme = THEMES.find(t => t.id === session?.themeId);
  const depth = DEPTHS.find(d => d.value === session?.depth);
  const disabled = busy || spinning || !!error;
  let content = '';
  if (invalid) {
    content = '<section class="rest-card"><div class="story-symbol">✧</div><h1 tabindex="-1">Сохранение недоступно</h1><p>Не удалось прочитать сохранённую игру. Она не была удалена. Можно попробовать ещё раз или явно начать новую.</p><div class="stack">' + button('Попробовать снова','reload','primary') + button('Начать новую игру','new') + '</div></section>';
  } else if (resume) {
    content = '<section class="rest-card"><div class="story-symbol">♡</div><p class="eyebrow">ВРЕМЯ ДРУГ ДЛЯ ДРУГА</p><h1 tabindex="-1">Продолжим разговор?</h1><p>Ваша игра здесь. Вернитесь к тому вопросу, на котором остановились.</p><div class="stack">' + button('Продолжить','resume','primary',disabled) + button('Начать новую игру','new','secondary',disabled) + '</div></section>';
  } else if (ended) {
    content = '<section class="rest-card"><div class="story-symbol">❋</div><p class="eyebrow">САМОЕ ВАЖНОЕ — БЫТЬ РЯДОМ</p><h1 tabindex="-1">Спасибо за разговор</h1><p>У каждой встречи — свои истории.<br>Возвращайтесь, когда захочется поговорить.</p>' + button('Начать новую игру','start','primary',disabled) + '</section>';
  } else if (phase === 'theme' || phase === 'depth') {
    const isTheme = phase === 'theme';
    const selected = isTheme ? session?.themeId : session?.depth;
    const options = isTheme ? THEMES.map((t,i) => ({ key:t.id, label:t.label, color:t.color, light:t.light, symbol:t.symbol, short:String(i+1), note:'' }))
      : DEPTHS.map(d => ({ key:String(d.value), label:d.label, color:d.color, light:d.light, symbol:String(d.value), short:String(d.value), note:d.description }));
    const heading = isTheme ? 'О чём поговорим?' : 'Насколько глубоко?';
    const restingRotation = selected ? -(options.findIndex(t => String(t.key) === String(selected)) + .5) * 360/options.length : 0;
    content = '<section class="selection"><div class="screen-intro"><p class="eyebrow">' + (isTheme ? 'СЕМЕЙНАЯ ИГРА ДЛЯ ЖИВОГО РАЗГОВОРА' : escape(theme!.label).toUpperCase()) + '</p><h1 tabindex="-1">' + heading + '</h1><p>' + (isTheme ? 'Выберите тему или доверьтесь случаю' : 'Глубина разговора — это открытость, а не сложность') + '</p></div><div class="choice-layout"><section class="roulette-panel" aria-label="Случайный выбор"><div class="wheel-wrap"><span class="pointer"></span><div class="wheel" style="transform:rotate(' + (spinning ? 0 : restingRotation) + 'deg)">' + wheel(options) + '</div></div><div class="roulette-caption"><p class="eyebrow">МАЛЕНЬКАЯ ИНТРИГА</p><p class="roulette-title">Пусть решит<br>рулетка</p>' + button(spinning ? 'Выбираем…' : 'Крутить','spin','spin-button',disabled) + '</div></section><section class="manual-panel" aria-label="' + (isTheme ? 'Темы' : 'Глубина разговора') + '"><div class="options ' + (isTheme ? '' : 'depth-options') + '">' + options.map(t => {
      const chosen = !spinning && String(selected) === String(t.key);
      return '<button class="option ' + (chosen ? 'chosen' : '') + '" data-action="pick:' + t.key + '" aria-pressed="' + chosen + '" style="--accent:' + t.color + ';--tint:' + t.light + '"' + (disabled ? ' disabled' : '') + '><span class="option-symbol" aria-hidden="true">' + t.symbol + '</span><span><span class="option-title">' + escape(t.label) + '</span>' + (t.note ? '<span class="option-description">' + escape(t.note) + '</span>' : '') + '</span><span class="check" aria-hidden="true">' + (chosen ? '✓' : '') + '</span></button>';
    }).join('') + '</div>' + button('Продолжить','continue','primary continue',disabled || !selected)  + '</section></div><p class="gentle-note">' + (isTheme ? 'Здесь нет правильных ответов. Только ваши истории.' : 'Можно выбрать другой уровень или пропустить любой вопрос.') + '</p></section>';
  } else if (phase === 'question') {
    const q = QUESTIONS.find(q => q.id === session!.currentQuestionId)!;
    content = '<section class="question-screen"><p class="eyebrow">СЛУШАЙТЕ. ВСПОМИНАЙТЕ. УДИВЛЯЙТЕСЬ.</p><article class="question-card" style="--accent:' + theme!.color + ';--tint:' + theme!.light + '"><div class="card-top"><span class="theme-badge">' + escape(theme!.label) + '</span><span class="depth-badge">Уровень ' + depth!.value + ' · ' + depth!.label + '</span></div><span class="quote-mark" aria-hidden="true">“</span><h1 class="question-text" tabindex="-1">' + escape(q.text) + '</h1><div class="card-bottom"><span>Вопрос ' + q.displayNumber + '</span><span aria-hidden="true">✧</span></div></article><p class="gentle-note">Каждый может ответить, послушать или пропустить.<br>У разговора нет таймера.</p><div class="question-actions">' + button('Следующий вопрос','next','primary',disabled) + button('Пропустить','skip','secondary',disabled) + '</div>' + button('Сменить тему или глубину','change','text-button',disabled) + '</section>';
  } else {
    const all = session!.shownIds.length === QUESTIONS.length;
    content = '<section class="rest-card"><div class="story-symbol">✦</div><h1 tabindex="-1">' + (all ? 'У каждой истории есть продолжение' : 'Попробуем другую тему?') + '</h1><p>' + (all ? 'Все вопросы этой игры уже были показаны. Можно начать новую игру или завершить разговор.' : 'В этой теме и на этом уровне вопросы закончились. Выберите другое сочетание или начните новую игру.') + '</p><div class="stack">' + (!all ? button('Сменить тему или глубину','change','primary',disabled) : '') + button('Начать новую игру','new',all ? 'primary' : 'secondary',disabled) + button('Завершить игру','end','text-button',disabled) + '</div></section>';
  }
  const focusKey = (document.activeElement as HTMLElement)?.dataset.action;
  app.innerHTML = '<div class="page" data-screen="' + (resume || invalid || ended ? 'rest' : phase) + '" data-offline-ready="' + ready + '"><header class="site-header"><a class="brand" href="' + import.meta.env.BASE_URL + '" aria-label="Наши истории — главная"><span class="brand-mark" aria-hidden="true">❋</span><span>Наши истории</span></a>' + button('Как играть','rules','text-button') + '</header><main>' + (error ? '<div class="error" role="alert"><p>' + escape(error) + '</p>' + (pending ? button('Повторить','retry','secondary') : button('Загрузить сохранённую игру','reload','secondary')) + '</div>' : '') + content + '</main><footer>' + (!resume && phase === 'depth' ? button('Назад к темам','back','text-button',disabled) : '') + (session && !resume && !invalid && phase !== 'exhausted' ? button('Завершить игру','end','text-button',disabled) : '') + '<p class="offline-status" hidden>' + (ready ? '<span aria-hidden="true">✓ </span>' : '') + escape(offline) + '</p>' + (!ready && offline.startsWith('Не удалось') ? button('Повторить подготовку','offline','text-button') : '') + (update ? (session ? '<p>Обновление готово. Его можно применить после игры.</p>' : button('Обновить приложение','update','text-button')) : '') + '<p class="footer-line">Ближе друг к другу, история за историей</p></footer></div>';
  app.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(el => el.addEventListener('click', () => void handle(el.dataset.action!)));
  app.querySelector('.brand')?.addEventListener('click', e => { e.preventDefault(); if (!resume && session) void act({type:'change'}); });
  if (focusKey) app.querySelector<HTMLElement>('[data-action="' + focusKey + '"]')?.focus({ preventScroll: true });
}
function wheel(options: {key:string; color:string; light:string; symbol:string}[]) {
  const n = options.length;
  const paths = options.map((option,i) => {
    const color = option.color;
    const a = (i * 2 * Math.PI/n) - Math.PI/2, b = ((i+1)*2*Math.PI/n)-Math.PI/2;
    const mid = (a+b)/2;
    return '<path data-option="' + option.key + '" d="M100 100 L' + (100+96*Math.cos(a)) + ' ' + (100+96*Math.sin(a)) + ' A96 96 0 0 1 ' + (100+96*Math.cos(b)) + ' ' + (100+96*Math.sin(b)) + 'Z" fill="' + color + '" stroke="#fff" stroke-width="2"/><text x="' + (100+63*Math.cos(mid)) + '" y="' + (106+63*Math.sin(mid)) + '" text-anchor="middle" fill="#fff" font-size="23" font-family="system-ui">' + option.symbol + '</text>';
  }).join('');
  return '<svg viewBox="0 0 200 200" aria-hidden="true">' + paths + '<circle cx="100" cy="100" r="24" fill="white"/><g class="wheel-center" fill="none" stroke="#255b52" stroke-width="2.5" stroke-linejoin="round"><path d="M86 86h21a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5H95l-7 6v-6h-2a5 5 0 0 1-5-5V91a5 5 0 0 1 5-5Z"/><path d="M117 96v13a6 6 0 0 1-6 6h-5l-1 5-6-5"/></g></svg>';
}
async function commit(candidate: Session | undefined, after: () => void = () => {}) {
  if (busy) return false;
  busy = true; error = ''; pending = {candidate,after}; render();
  try {
    key = await commitRaw(key, candidate, release(candidate));
    session = candidate; pending = null; sync?.postMessage('changed'); after(); render();
    return true;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Не удалось сохранить ход игры';
    if (error.includes('другой вкладке')) pending = null;
    return false;
  } finally { busy = false; render(); }
}
async function act(action: Action) {
  if (busy || spinning || error) return;
  const before = session?.phase;
  const candidate = transition(session || fresh(), action);
  if (await commit(candidate)) {
    if (before !== candidate.phase) focusHeading();
  }
}
function focusHeading() { app.querySelector<HTMLElement>('h1')?.focus({ preventScroll:true }); window.scrollTo({ top:0, behavior:'instant' }); }
function showDialog(title: string, body: string, confirmLabel?: string, confirmed?: () => void) {
  const source = document.activeElement as HTMLElement;
  dialog.innerHTML = '<div class="dialog-inner"><h2>' + escape(title) + '</h2><div class="dialog-copy">' + body + '</div><div class="stack">' + (confirmLabel ? '<button class="primary" id="confirm-dialog">' + confirmLabel + '</button><button class="secondary" id="close-dialog">Остаться</button>' : '<button class="primary" id="close-dialog">Понятно</button>') + '</div></div>';
  dialog.querySelector('#close-dialog')!.addEventListener('click', () => dialog.close());
  dialog.querySelector('#confirm-dialog')?.addEventListener('click', () => { dialog.close(); confirmed?.(); });
  dialog.onclose = () => source?.isConnected && source.focus();
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>(confirmLabel ? '#close-dialog' : '#close-dialog')!.focus();
}
async function handle(action: string) {
  if (action === 'rules') {
    showDialog('Как играть', '<p>Выберите тему и глубину разговора — сами или рулеткой. Случайный выбор всегда можно изменить до нажатия «Продолжить».</p><ul><li>На один вопрос могут ответить все желающие, в любом порядке.</li><li>Короткого ответа достаточно. Можно просто послушать или пропустить.</li><li>Когда кто-то рассказывает, остальные слушают, не перебивая.</li><li>Не торопитесь: важнее разговор, чем количество карточек.</li></ul><p>После первой успешной загрузки можно играть без интернета. ' + escape(offline) + '<br>Ответы не записываются. На этом телефоне сохраняется только ход игры. Очистка данных сайта удалит сохранение и может удалить автономную версию.</p>');
    return;
  }
  if (action === 'reload') { await load(); return; }
  if (action === 'offline') { void prepareOffline(); return; }
  if (action === 'retry' && pending) { const task = pending; await commit(task.candidate, task.after); return; }
  if (action === 'update' && !session) {
    if (registration?.waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once:true});
      registration.waiting.postMessage({type:'ACTIVATE'});
    } else location.reload();
    return;
  }
  if (busy || spinning || error) return;
  if (action === 'resume') { resume = false; render(); focusHeading(); return; }
  if (action === 'new') {
    showDialog('Начать новую игру?', '<p>Текущая игра будет завершена. Все вопросы снова станут доступны.</p>', 'Начать новую', () => {
      void commit(fresh(), () => { resume=false; invalid=false; ended=false; }).then(focusHeading);
    }); return;
  }
  if (action === 'start') { await commit(fresh(), () => { ended=false; }); focusHeading(); return; }
  if (action === 'end') {
    showDialog('Завершить игру?', '<p>Можно продолжить разговор без карточек. Следующая игра начнётся с полной колоды.</p>', 'Завершить', () => {
      void commit(undefined, () => { ended=true; resume=false; }).then(() => { focusHeading(); void checkOffline(); });
    }); return;
  }
  if (action.startsWith('pick:')) {
    const value = action.slice(5);
    await act((session?.phase || 'theme') === 'theme' ? {type:'theme',value:value as ThemeId} : {type:'depth',value:Number(value) as Depth}); return;
  }
  if (action === 'spin') {
    const isTheme = (session?.phase || 'theme') === 'theme';
    const n = isTheme ? 6 : 3, index = randomIndex(n);
    const candidate = transition(session || fresh(), isTheme ? {type:'theme',value:THEMES[index].id} : {type:'depth',value:DEPTHS[index].value});
    spinning = true;
    const success = await commit(candidate, () => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {spinning=false;return;}
      spinning=true;
      requestAnimationFrame(() => {
        const el=app.querySelector<HTMLElement>('.wheel');
        if (!el) {spinning=false;render();return;}
        const animation=el.animate([
          {transform:'rotate(0deg)'},
          {transform:'rotate(' + (1440-(index+.5)*360/n) + 'deg)'},
        ],{duration:1200,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'});
        void animation.finished.then(() => {spinning=false;render();}).catch(() => {spinning=false;render();});
      });
    });
    if (!success) {spinning=false;render();}
    return;
  }
  if (action === 'continue') { await act({type:'continue'}); return; }
  if (action === 'back' || action === 'change') { await act({type:'change'}); return; }
  if (action === 'next' || action === 'skip') {
    if (performance.now() - lastDraw < 350) return;
    lastDraw=performance.now();
    await act({type:'next'});
  }
}
async function load() {
  busy=true; error=''; pending=null;
  try {
    const raw = await readRaw();
    key = fingerprint(raw);
    invalid = false; resume = false; ended=false; session=undefined;
    if (raw.snapshot !== undefined || raw.release !== undefined) {
      try {
        validateSession(raw.snapshot);
        const meta = raw.release as {formatVersion:number;sessionId:string;buildId:string};
        if (raw.snapshot.buildId !== __BUILD_ID__ || meta?.formatVersion !== 1 || meta?.sessionId !== raw.snapshot.sessionId || meta?.buildId !== raw.snapshot.buildId) throw new Error('Несовместимое сохранение');
        session=raw.snapshot; resume=true;
      } catch { invalid=true; }
    }
  } catch (e) { error=e instanceof Error ? e.message : 'Не удалось открыть сохранение'; }
  finally { busy=false;render(); }
}
async function checkOffline() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return;
  try {
    const channel = new MessageChannel();
    const status = await new Promise<{ready:boolean;buildId:string}>((resolve,reject) => {
      const timer=setTimeout(() => {channel.port1.close();reject(new Error('Подготовка ещё не завершена'));}, 4000);
      channel.port1.onmessage=e => {clearTimeout(timer);channel.port1.close();resolve(e.data);};
      worker.postMessage({type:'STATUS'},[channel.port2]);
    });
    ready=status.ready;update=!!registration?.waiting || status.buildId !== __BUILD_ID__;
    offline=ready ? 'Можно играть без интернета' : 'Подготовка автономной игры ещё не завершена';
  } catch { ready=false;offline='Не удалось проверить автономную готовность'; }
  if (!spinning && !dialog.open) render();
}
async function prepareOffline() {
  if (offlinePreparing) return;
  if (!('serviceWorker' in navigator)) { offline='Автономность недоступна в этом браузере';render();return; }
  offlinePreparing = true;
  if (!ready) offline='Готовим игру для работы без интернета';
  if (!spinning && !dialog.open) render();
  try {
    registration=await navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js',{scope:import.meta.env.BASE_URL,type:'module'});
    registration.addEventListener('updatefound', () => {
      const worker=registration!.installing;
      worker?.addEventListener('statechange', () => { if (worker.state==='installed') setTimeout(() => void checkOffline(),100); });
    });
    // ready never rejects when an initial installation fails. Observe the actual worker instead.
    if (registration.active?.state !== 'activated') {
      await new Promise<void>((resolve,reject) => {
        const worker=registration!.installing || registration!.waiting || registration!.active;
        if (!worker) {reject(new Error('Установка не завершена'));return;}
        const finish = (failed:boolean) => {
          clearTimeout(timer);worker.removeEventListener('statechange',changed);
          failed ? reject(new Error('Установка не завершена')) : resolve();
        };
        const changed=() => {
          if(worker.state==='activated')finish(false);
          else if(worker.state==='redundant')finish(true);
        };
        const timer=setTimeout(()=>finish(true),15000);
        worker.addEventListener('statechange',changed);changed();
      });
    }
    await checkOffline();
  } catch { ready=false;offline='Не удалось подготовить игру без интернета';render(); }
  finally {offlinePreparing=false;if(!spinning && !dialog.open)render();}
}
if (!history.state?.nashi) history.pushState({nashi:true},'',location.href);
window.addEventListener('popstate', e => {
  if (e.state?.nashi) return;
  if (dialog.open) {dialog.close();history.pushState({nashi:true},'',location.href);return;}
  if (!resume && session && session.phase !== 'theme') {void act({type:'back'});history.pushState({nashi:true},'',location.href);}
});
async function verifyCurrent() {
  if (busy) return;
  const expected=key;
  try {
    const raw=await readRaw();
    if(!busy && expected===key && fingerprint(raw)!==key){error='Игра изменилась в другой вкладке';pending=null;render();}
  } catch { /* An actual transition reports persistent storage failures. */ }
}
sync?.addEventListener('message', () => void verifyCurrent());
document.addEventListener('visibilitychange', () => {if(document.visibilityState==='visible')void verifyCurrent();});
window.addEventListener('focus', () => {
  void verifyCurrent();
  void checkOffline();
});
window.addEventListener('online', () => void prepareOffline());
navigator.serviceWorker?.addEventListener('controllerchange', () => void checkOffline());
void load().then(() => void prepareOffline());
