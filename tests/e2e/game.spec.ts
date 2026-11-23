import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const DB = 'nashi-istorii:nashi-istorii';
async function saved(page: Page) {
  return page.evaluate(name => new Promise<any>((resolve,reject) => {
    const r=indexedDB.open(name);r.onerror=()=>reject(r.error);
    r.onsuccess=()=>{ const db=r.result,tx=db.transaction(['session','meta']);
      const s=tx.objectStore('session').get('active'),m=tx.objectStore('meta').get('activeRelease');
      tx.oncomplete=()=>{db.close();resolve({snapshot:s.result,release:m.result});};
    };
  }),DB);
}
async function choose(page: Page, theme='childhood') {
  await page.locator('[data-action="pick:'+theme+'"]').click();
  await expect(page.locator('[data-action="pick:'+theme+'"]')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.getByRole('button',{name:'Случайная карточка',exact:true}).click();
  await expect(page.locator('.question-text')).toBeVisible();
}
test.beforeEach(async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>{Math.random=()=>.125;});
  await page.goto('./');await page.getByRole('button',{name:'Играть',exact:true}).click();
  await expect(page.getByRole('heading',{name:'О чём поговорим?'})).toBeVisible();
});
test('ручной выбор, пропуск и точное восстановление',async({page})=>{
  await choose(page);
  const first=await saved(page);
  await page.getByRole('button',{name:'Пропустить',exact:true}).click();
  await page.getByRole('button',{name:'Случайная карточка',exact:true}).click();
  await expect.poll(async()=> (await saved(page)).snapshot.shownIds.length).toBe(2);
  const second=await saved(page);
  expect(second.snapshot.currentQuestionId).not.toBe(first.snapshot.currentQuestionId);
  await page.reload();await page.getByRole('button',{name:'Играть',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Продолжим разговор?'})).toBeVisible();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  expect((await saved(page)).snapshot).toEqual(second.snapshot);
  await expect(page.locator('.question-text')).toBeVisible();
});
test('рулетка ждёт подтверждения и позволяет ручной перевыбор',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Крутить',exact:true}).click();
  await expect(page.getByRole('button',{name:'Продолжить',exact:true})).toBeDisabled();
  await expect(page.locator('.option.chosen')).toHaveCount(0);
  await expect(page.locator('.option[aria-pressed="true"]')).toHaveCount(0);
  for(const option of await page.locator('.option').all()) await expect(option).toBeDisabled();
  await expect(page.getByRole('button',{name:'Крутить',exact:true})).toBeEnabled();
  await expect(page.locator('.option.chosen')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'О чём поговорим?'})).toBeVisible();
  expect((await saved(page)).snapshot.shownIds).toEqual([]);
  await expect(page.locator('.wheel')).toHaveAttribute('style',/rotate\(-30deg\)/);
  await page.locator('[data-action="pick:dreams"]').click();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Выбери карточку'})).toBeVisible();
  await expect(page.locator('.card-back')).toHaveCount(10);
  expect((await saved(page)).snapshot.shownIds).toEqual([]);
});
test('вся тема исчерпывается, становится серой и исключается из рулетки',async({page})=>{
  await choose(page);
  for(let i=1;i<=10;i++) {
    await expect.poll(async()=> (await saved(page)).snapshot.shownIds.length).toBe(i);
    await page.getByRole('button',{name:'Пропустить',exact:true}).click();
    if(i<10) {
      await expect(page.locator('.card-back')).toHaveCount(10-i);
      await page.locator('.card-back').last().click();
    }
  }
  await expect(page.getByText('Все вопросы этой темы уже показаны.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Сменить тему',exact:true}).click();
  await expect(page.locator('[data-action="pick:childhood"]')).toBeDisabled();
  await expect(page.locator('[data-action="pick:childhood"]')).toHaveClass(/depleted/);
  await page.getByRole('button',{name:'Крутить',exact:true}).click();
  await expect(page.locator('.option.chosen')).not.toHaveAttribute('data-action','pick:childhood');
  expect(new Set((await saved(page)).snapshot.shownIds).size).toBe(10);
});

test('отмена новой игры и завершения сохраняет карточку',async({page})=>{
  await choose(page);
  const before=await saved(page);
  await page.getByRole('button',{name:'Завершить игру',exact:true}).click();
  await page.getByRole('button',{name:'Остаться',exact:true}).click();
  expect(await saved(page)).toEqual(before);
  await page.reload();await page.getByRole('button',{name:'Играть',exact:true}).click();
  await page.getByRole('button',{name:'Начать новую игру',exact:true}).click();
  await page.getByRole('button',{name:'Остаться',exact:true}).click();
  expect(await saved(page)).toEqual(before);
  await page.getByRole('button',{name:'Начать новую игру',exact:true}).click();
  await page.getByRole('button',{name:'Начать новую',exact:true}).last().click();
  await expect(page.getByRole('heading',{name:'О чём поговорим?'})).toBeVisible();
  expect((await saved(page)).snapshot.shownIds).toEqual([]);
});
test('повреждённое сохранение не удаляется без подтверждения',async({page})=>{
  await choose(page);
  await page.evaluate(name=>new Promise<void>(resolve=>{
    const r=indexedDB.open(name);r.onsuccess=()=>{const db=r.result,tx=db.transaction('session','readwrite');tx.objectStore('session').put({schemaVersion:999},'active');tx.oncomplete=()=>{db.close();resolve();};};
  }),DB);
  await page.reload();await page.getByRole('button',{name:'Играть',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Сохранение недоступно'})).toBeVisible();
  expect((await saved(page)).snapshot.schemaVersion).toBe(999);
  await page.getByRole('button',{name:'Начать новую игру',exact:true}).click();
  await page.getByRole('button',{name:'Остаться',exact:true}).click();
  expect((await saved(page)).snapshot.schemaVersion).toBe(999);
});
test('abort транзакции не принимает новую карточку, retry использует тот же переход',async({page})=>{
  await choose(page);
  const before=await saved(page),text=await page.locator('.question-text').textContent();
  await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    (window as any).restorePut=()=>{IDBObjectStore.prototype.put=original;};
    IDBObjectStore.prototype.put=function(...args:any[]) {
      const request=(original as any).apply(this,args);
      queueMicrotask(()=>this.transaction.abort());return request;
    };
  });
  await page.getByRole('button',{name:'Выбрать карточку',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось сохранить');
  expect(await saved(page)).toEqual(before);
  await expect(page.locator('.question-text')).toHaveText(text!);
  await page.evaluate(()=>(window as any).restorePut());
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await page.getByRole('button',{name:'Случайная карточка',exact:true}).click();
  await expect.poll(async()=> (await saved(page)).snapshot.shownIds.length).toBe(2);
});
test('неизвестная привязка выпуска открывает безопасное восстановление',async({page})=>{
  await expect(page.locator('.page[data-offline-ready="true"]')).toBeVisible();
  await choose(page);
  const before=await saved(page);
  await page.evaluate(name=>new Promise<void>(resolve=>{
    const r=indexedDB.open(name);r.onsuccess=()=>{const db=r.result,tx=db.transaction('meta','readwrite');
      tx.objectStore('meta').put({formatVersion:999,buildId:'unknown'},'activeRelease');
      tx.oncomplete=()=>{db.close();resolve();};
    };
  }),DB);
  await page.reload();await page.getByRole('button',{name:'Играть',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Сохранение недоступно'})).toBeVisible();
  expect((await saved(page)).snapshot).toEqual(before.snapshot);
  expect((await saved(page)).release.formatVersion).toBe(999);
  await page.getByRole('button',{name:'Начать новую игру',exact:true}).click();
  await page.getByRole('button',{name:'Начать новую',exact:true}).click();
  await expect(page.getByRole('heading',{name:'О чём поговорим?'})).toBeVisible();
  expect((await saved(page)).snapshot.shownIds).toEqual([]);
  expect((await saved(page)).release.formatVersion).toBe(1);
});
test('двойной тап не расходует две карточки',async({page})=>{
  await choose(page);
  await page.getByRole('button',{name:'Выбрать карточку',exact:true}).click();
  await page.getByRole('button',{name:'Случайная карточка',exact:true}).dblclick();
  await expect.poll(async()=> (await saved(page)).snapshot.shownIds.length).toBe(2);
});
test('другая вкладка не перезаписывает новую revision',async({page,context})=>{
  await choose(page);
  const other=await context.newPage();await other.goto('./');await other.getByRole('button',{name:'Играть',exact:true}).click();
  await other.getByRole('button',{name:'Продолжить',exact:true}).click();
  await other.getByRole('button',{name:'Выбрать карточку',exact:true}).click();
  const latest=await saved(other);
  await page.bringToFront();
  await expect(page.getByRole('alert')).toContainText('другой вкладке');
  expect(await saved(page)).toEqual(latest);
  await page.getByRole('button',{name:'Загрузить сохранённую игру'}).click();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  expect(await saved(page)).toEqual(latest);
});
test('полная колода исчерпана: только новая игра или завершение',async({page})=>{
  await choose(page);
  await page.evaluate(name=>new Promise<void>(resolve=>{
    const r=indexedDB.open(name);r.onsuccess=()=>{const db=r.result,tx=db.transaction('session','readwrite'),store=tx.objectStore('session'),get=store.get('active');
      get.onsuccess=()=>store.put({...get.result,phase:'exhausted',currentQuestionId:null,shownIds:Array.from({length:60},(_,i)=>'q'+String(i+1).padStart(3,'0'))},'active');
      tx.oncomplete=()=>{db.close();resolve();};
    };
  }),DB);
  await page.reload();await page.getByRole('button',{name:'Играть',exact:true}).click();await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.getByText('Все вопросы этой игры уже были показаны.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Сменить тему'})).toHaveCount(0);
  expect((await saved(page)).snapshot.shownIds).toHaveLength(60);
});
test('холодный запуск без сети, PWA и изоляция подпапки',async({page,context})=>{
  await expect(page.locator('.page[data-offline-ready="true"]')).toBeVisible();
  await choose(page);
  const before=await saved(page);
  const scope=await page.evaluate(async()=> (await navigator.serviceWorker.getRegistration())?.scope);
  expect(scope).toBe('http://127.0.0.1:48971/nashi-istorii/');
  const manifest=await page.evaluate(async()=> (await fetch('manifest.webmanifest')).json());
  expect(manifest.scope).toBe('./');expect(manifest.icons).toHaveLength(2);
  await page.close();await context.setOffline(true);
  const cold=await context.newPage();cold.on('pageerror',e=>console.log('COLD PAGE ERROR',e.message));cold.on('requestfailed',r=>console.log('COLD FAILED',r.url(),r.failure()?.errorText));await cold.goto('./');await cold.getByRole('button',{name:'Играть',exact:true}).click();
  await cold.getByRole('button',{name:'Продолжить',exact:true}).click();
  expect(await saved(cold)).toEqual(before);
  await expect(cold.locator('.question-text')).toBeVisible();
  await context.setOffline(false);
  const neighbor=await context.newPage();await neighbor.goto('http://127.0.0.1:48971/neighbor/');
  expect(await neighbor.evaluate(()=>navigator.serviceWorker.controller?.scriptURL??null)).toBeNull();
});
test('макеты, текст 200% и отсутствие внешних запросов',async({page})=>{
  const external:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:48971/'))external.push(r.url());});
  await mkdir('test-results/screenshots',{recursive:true});
  for(const width of [360,390,412]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/screenshots/theme-'+width+'.png',fullPage:true});
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='36px');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/screenshots/text-200.png',fullPage:true});
  await page.evaluate(()=>document.documentElement.style.fontSize='18px');
  await choose(page);await page.screenshot({path:'test-results/screenshots/question.png',fullPage:true});
  expect(external).toEqual([]);
});

test('цвета рулетки совпадают с выбранными плашками; правила для всей семьи',async({page})=>{
  for(const id of ['childhood','self','relationships','dreams','meanings','unexpected']) {
    await page.locator('[data-action="pick:'+id+'"]').click();
    const color=await page.locator('.wheel path[data-option="'+id+'"]').getAttribute('fill');
    await expect.poll(()=>page.locator('.option.chosen').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent'))).toBe(color);
  }
  await expect(page.locator('.wheel-center path')).toHaveCount(2);
  await expect(page.locator('.wheel text').filter({hasText:'✦'})).toHaveCount(1);
  await page.getByRole('button',{name:'Как играть'}).click();
  await expect(page.getByRole('dialog')).toContainText('все желающие');
  await expect(page.getByRole('dialog')).toContainText('Наслаждайся! Искренний ответ и молчаливое слушание сближают.');
  await expect(page.getByRole('dialog')).not.toContainText(/Выберите|нажмите|Не торопитесь/);
  await expect(page.locator('.brand')).toHaveText('Сближение');
  await expect(page.locator('[data-action="pick:relationships"]')).toContainText('Отношения');
  await expect(page.locator('[data-action="pick:meanings"]')).toContainText('Ценности и смыслы');
  const manifest=await page.evaluate(async()=> (await fetch('manifest.webmanifest')).json());
  expect(manifest.name).toBe('Сближение');expect(manifest.short_name).toBe('Сближение');
  await expect(page.getByRole('dialog')).not.toContainText(/обе|одна говорит|другая слушает/);
  await page.getByRole('button',{name:'Играть',exact:true}).click();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.getByRole('button',{name:'Случайная карточка',exact:true}).click();
  await expect(page.locator('.gentle-note')).toContainText('Каждый может ответить');
});

test('основные экраны помещаются по высоте телефона',async({page})=>{
  for(const size of [{width:360,height:640},{width:390,height:740},{width:412,height:844}]) {
    await page.setViewportSize(size);
    await expect(page.locator('.selected-result')).toHaveCount(0);
    await expect(page.locator('.offline-status')).toBeHidden();
    await expect.poll(()=>page.locator('.wheel-wrap').evaluate(el=>el.getBoundingClientRect().width)).toBe(size.height<=740?138:174);
    const fits=()=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1);
    expect(await fits(),JSON.stringify(await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,blocks:[...document.querySelectorAll('.site-header,.screen-intro,.roulette-panel,.options,.selected-result,.continue,footer,.manual-panel>.text-button')].map(e=>({class:e.className,height:e.getBoundingClientRect().height}))})))).toBe(true);
    await page.locator('[data-action="pick:unexpected"]').click();
    await page.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Выбери карточку'})).toBeVisible();
    expect(await fits(),JSON.stringify(await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,blocks:[...document.querySelectorAll('.site-header,.screen-intro,.roulette-panel,.options,.selected-result,.continue,footer,.manual-panel>.text-button')].map(e=>({class:e.className,height:e.getBoundingClientRect().height}))})))).toBe(true);
    await page.locator('.card-back').first().click();
    await expect(page.locator('.question-text')).toBeVisible();
    expect(await fits(),JSON.stringify(await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,blocks:[...document.querySelectorAll('.site-header,.screen-intro,.roulette-panel,.options,.selected-result,.continue,footer,.manual-panel>.text-button')].map(e=>({class:e.className,height:e.getBoundingClientRect().height}))})))).toBe(true);
    await expect(page.getByRole('button',{name:'Выбрать карточку',exact:true})).toBeInViewport();
    expect(await page.locator('.question-card').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(size.height*.5);
    await page.getByRole('button',{name:'Сменить тему'}).click();
    await expect(page.getByRole('heading',{name:'О чём поговорим?'})).toBeVisible();
  }
});

test('рубашки одинаковые, раскладка восстанавливается после закрытия',async({page})=>{
  await page.setViewportSize({width:390,height:740});
  await page.locator('[data-action="pick:childhood"]').click();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('.card-back')).toHaveCount(10);
  expect(new Set(await page.locator('.card-back').allTextContents()).size).toBe(1);
  await expect(page.locator('.depth-options,.question-text')).toHaveCount(0);
  await page.screenshot({path:'test-results/screenshots/cards.png',fullPage:true});
  await page.locator('.card-back').nth(4).click();
  await page.getByRole('button',{name:'Пропустить',exact:true}).click();
  await expect(page.locator('.card-back')).toHaveCount(9);
  const before=await saved(page);
  await page.reload();await page.getByRole('button',{name:'Играть',exact:true}).click();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('.card-back')).toHaveCount(9);
  expect(await saved(page)).toEqual(before);
});

test('приветствие, инструкция с начала и фонарик после завершения',async({page})=>{
  await page.setViewportSize({width:360,height:640});
  await page.reload();
  await expect(page.locator('.welcome-screen')).toBeVisible();
  await expect(page.locator('.welcome-message')).toContainText('Цени время, проведённое вместе.');
  await expect(page.locator('.welcome-logo')).toHaveJSProperty('naturalWidth',1418);
  await page.screenshot({path:'test-results/screenshots/welcome.png',fullPage:true});
  for(let i=0;i<2;i++) {
    await page.getByRole('button',{name:'Как играть',exact:true}).click();
    const rules=page.getByRole('dialog');
    await expect.poll(()=>rules.evaluate(el=>el.scrollTop)).toBe(0);
    await expect(rules.getByRole('heading',{name:'Как играть'})).toBeInViewport();
    await expect(rules.locator('.dialog-copy p').first()).toBeInViewport();
    await page.screenshot({path:'test-results/screenshots/rules.png',fullPage:true});
    await rules.evaluate(el=>el.scrollTop=el.scrollHeight);
    await rules.getByRole('button',{name:'Играть',exact:true}).click();
  }
  await page.locator('[data-action="enter"]').click();
  await choose(page);
  await page.getByRole('button',{name:'Завершить игру',exact:true}).click();
  await page.getByRole('button',{name:'Завершить',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Спасибо за разговор'})).toBeVisible();
  await expect(page.locator('.end-lantern')).toBeVisible();
  await expect(page.locator('.rest-card')).toContainText('САМОЕ ВАЖНОЕ — БЫТЬ РЯДОМ');
  await expect(page.locator('.rest-card')).toContainText('У каждой встречи — свои истории.');
  await expect(page.locator('.rest-card')).toContainText('Возвращайся, когда захочется поговорить.');
  await page.screenshot({path:'test-results/screenshots/ended.png',fullPage:true});
});
