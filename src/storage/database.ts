export const DB_NAME = __DB_NAME__;
export interface RawSave { snapshot?: unknown; release?: unknown }
export function fingerprint(raw: RawSave): string { return JSON.stringify([raw.snapshot ?? null, raw.release ?? null]); }
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    request.onblocked = () => { settled = true; reject(new Error('Закрой другую вкладку игры и попробуй снова')); };
    request.onerror = () => reject(new Error('Не удалось открыть сохранение на этом устройстве'));
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
export async function readRaw(): Promise<RawSave> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(['session', 'meta'], 'readonly'); }
    catch { db.close(); reject(new Error('Не удалось прочитать сохранение')); return; }
    const s = tx.objectStore('session').get('active');
    const m = tx.objectStore('meta').get('activeRelease');
    tx.oncomplete = () => { db.close(); resolve({ snapshot: s.result, release: m.result }); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Не удалось прочитать сохранение')); };
  });
}
export async function commitRaw(expected: string, snapshot: unknown, release: unknown): Promise<string> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(['session', 'meta'], 'readwrite'); }
    catch { db.close(); reject(new Error('Не удалось сохранить ход игры. Попробуй ещё раз')); return; }
    const s = tx.objectStore('session').get('active');
    const m = tx.objectStore('meta').get('activeRelease');
    let count = 0;
    let conflict = false;
    const ready = () => {
      if (++count !== 2) return;
      if (fingerprint({ snapshot: s.result, release: m.result }) !== expected) { conflict = true; tx.abort(); return; }
      if (snapshot === undefined) { tx.objectStore('session').delete('active'); tx.objectStore('meta').delete('activeRelease'); }
      else { tx.objectStore('session').put(snapshot, 'active'); tx.objectStore('meta').put(release, 'activeRelease'); }
    };
    s.onsuccess = ready; m.onsuccess = ready;
    tx.oncomplete = () => { db.close(); resolve(fingerprint({ snapshot, release })); };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error(conflict ? 'Игра изменилась в другой вкладке' : 'Не удалось сохранить ход игры. Попробуй ещё раз'));
    };
  });
}
