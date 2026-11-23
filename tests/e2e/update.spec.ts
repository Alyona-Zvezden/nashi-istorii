import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';

test('новый worker сохраняет выпуск активной игры после закрытия всех вкладок',async({browser})=>{
  test.setTimeout(120000);
  const paths:Record<string,string>={};
  for(const id of ['release-a','release-b']) {
    const env={...process.env,APP_BUILD_ID:id,OUT_DIR:'test-results/'+id};
    execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{env,stdio:'pipe'});
    execFileSync(process.execPath,['scripts/build-offline.mjs'],{env,stdio:'pipe'});
    paths[id]=resolve('test-results',id);
  }
  let active='release-a';
  let incomplete = false;
  const base='/nashi-istorii/';
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://127.0.0.1');
    if(!url.pathname.startsWith(base)){res.writeHead(404).end();return;}
    const relative=decodeURIComponent(url.pathname.slice(base.length))||'index.html';
    if(incomplete && relative==='icons/icon-512.png'){res.writeHead(503).end();return;}
    const file=resolve(paths[active],relative);
    if(!file.startsWith(paths[active]+'/') && !file.startsWith(paths[active]+'\\')){res.writeHead(403).end();return;}
    try {
      const data=await readFile(file);
      const type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'} as Record<string,string>)[extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(data);
    }catch{res.writeHead(404).end();}
  });
  await new Promise<void>(resolve=>server.listen(48972,'0.0.0.0',resolve));
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  try {
    const page=await context.newPage();await page.goto('http://127.0.0.1:48972'+base);
    await expect(page.locator('.page[data-offline-ready="true"]')).toBeVisible();
    await page.locator('[data-action="pick:childhood"]').click();
    await page.getByRole('button',{name:'Продолжить',exact:true}).click();
    await page.getByRole('button',{name:'Случайная карточка',exact:true}).click();
    const question=await page.locator('.question-text').textContent();
    expect(await page.locator('meta[name="app-release"]').getAttribute('content')).toBe('release-a');
    active='release-b';
    incomplete=true;
    const failed=await page.evaluate(async()=> {
      const r=(await navigator.serviceWorker.getRegistration())!;
      return new Promise<string>((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Не получен результат установки')),7000);
        r.addEventListener('updatefound',()=>{
          const worker=r.installing!;
          worker.addEventListener('statechange',()=>{if(worker.state==='redundant'){clearTimeout(timeout);resolve('failed');}});
        },{once:true});
        void r.update().catch(()=>{clearTimeout(timeout);resolve('failed');});
      });
    });
    expect(failed).toBe('failed');
    await page.reload();await page.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(page.locator('.question-text')).toHaveText(question!);
    await expect(page.locator('meta[name="app-release"]')).toHaveAttribute('content','release-a');
    incomplete=false;
    await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r!.update();});
    await expect.poll(()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
    await page.close();
    // Let the browser activate B with no remaining A clients; then return with no network.
    await context.setOffline(true);
    const cold=await context.newPage();await cold.goto('http://127.0.0.1:48972'+base);
    await expect(cold.getByRole('heading',{name:'Продолжим разговор?'})).toBeVisible();
    await expect(cold.locator('meta[name="app-release"]')).toHaveAttribute('content','release-a');
    await expect(cold.getByText('Обновление готово.',{exact:false})).toBeVisible();
    await cold.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(cold.locator('.question-text')).toHaveText(question!);
    await cold.getByRole('button',{name:'Завершить игру',exact:true}).click();
    await cold.getByRole('button',{name:'Завершить',exact:true}).click();
    await expect(cold.getByRole('button',{name:'Обновить приложение'})).toBeVisible();
    await cold.getByRole('button',{name:'Обновить приложение'}).click();
    await expect(cold.getByRole('heading',{name:'О чём поговорим?'})).toBeVisible();
    await expect(cold.locator('meta[name="app-release"]')).toHaveAttribute('content','release-b');
    await expect(cold.locator('.page[data-offline-ready="true"]')).toBeVisible();
  }finally{await context.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
