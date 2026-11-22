import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
test('ошибка первой установки видима, повтор восстанавливает автономность',async({browser})=>{
  let broken=true;
  const root=resolve('dist'),base='/nashi-istorii/';
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url!,'http://127.0.0.1').pathname;
    if(!path.startsWith(base)){res.writeHead(404).end();return;}
    const relative=decodeURIComponent(path.slice(base.length))||'index.html';
    if(broken && relative==='icons/icon-512.png'){res.writeHead(503).end();return;}
    const file=resolve(root,relative);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    try {
      const data=await readFile(file);
      const type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'} as Record<string,string>)[extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Vary':'Accept-Encoding'}).end(data);
    }catch{res.writeHead(404).end();}
  });
  await new Promise<void>(resolve=>server.listen(48973,'0.0.0.0',resolve));
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  try {
    const page=await context.newPage();await page.goto('http://127.0.0.1:48973'+base);
    await expect(page.getByRole('heading',{name:'О чём поговорим?'})).toBeVisible();
    await expect(page.locator('.offline-status')).toHaveText('Не удалось подготовить игру без интернета');
    await expect(page.locator('.page[data-offline-ready="true"]')).toHaveCount(0);
    broken=false;
    await page.getByRole('button',{name:'Повторить подготовку'}).click();
    await expect(page.locator('.page[data-offline-ready="true"]')).toBeVisible();
    await page.locator('[data-action="pick:childhood"]').click();
    await page.getByRole('button',{name:'Продолжить',exact:true}).click();
    await page.locator('[data-action="pick:1"]').click();
    await page.getByRole('button',{name:'Продолжить',exact:true}).click();
    const question=await page.locator('.question-text').textContent();
    await page.close();await context.setOffline(true);
    const cold=await context.newPage();await cold.goto('http://127.0.0.1:48973'+base);
    await cold.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(cold.locator('.question-text')).toHaveText(question!);
  }finally{await context.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
