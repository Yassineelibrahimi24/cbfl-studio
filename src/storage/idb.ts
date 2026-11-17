import type { Project } from '../types';
import { isProject } from '../types';

const DB_NAME = 'cbfl';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveProjectRecord(project: Project): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(project, 'project');
  await txDone(tx);
  db.close();
}

export async function saveBlobs(blobs: Map<string, ArrayBuffer>): Promise<void> {
  if (blobs.size === 0) return;
  const db = await openDb();
  const tx = db.transaction('blobs', 'readwrite');
  const store = tx.objectStore('blobs');
  for (const [id, bytes] of blobs) store.put(bytes, id);
  await txDone(tx);
  db.close();
}

export async function loadBundle(): Promise<{ project: Project; blobs: Map<string, ArrayBuffer> } | null> {
  const db = await openDb();
  const project = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').get('project');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const blobs = new Map<string, ArrayBuffer>();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('blobs', 'readonly');
    const cursor = tx.objectStore('blobs').openCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      if (typeof row.key === 'string' && row.value instanceof ArrayBuffer) blobs.set(row.key, row.value);
      row.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  if (!isProject(project)) return null;
  return { project, blobs };
}
