import type { WorkspaceData } from '../types/data';
import { generateId } from './ids';

const DB = 'powerscroll-recovery';
const STORE = 'notebooks';
export interface RecoveryEntry { id: string; name: string; updatedAt: number; workspace: WorkspaceData; fileName?: string; bytes: number; }
function open(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const r = indexedDB.open(DB, 2); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
export async function initializeRecovery(): Promise<void> { const db = await open(); db.close(); }
export async function saveRecovery(workspace: WorkspaceData, fileName?: string): Promise<void> {
  if (!workspace.id) workspace.id = generateId();
  const entry: RecoveryEntry = { id: workspace.id, name: workspace.filename, updatedAt: Date.now(), workspace, fileName, bytes: new Blob([JSON.stringify(workspace)]).size };
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // A full disk (QuotaExceededError) aborts the transaction rather than
      // erroring the request, so the abort must reject too.
      tx.onabort = () => reject(tx.error ?? new Error('Browser storage refused the write'));
    });
  } finally {
    db.close();
  }
}
export async function listRecovery(): Promise<RecoveryEntry[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).getAll();
      r.onsuccess = () => resolve((r.result as RecoveryEntry[]).sort((a, b) => b.updatedAt - a.updatedAt));
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function deleteRecovery(id: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function migrateLibrary(): Promise<void> { const raw = localStorage.getItem('powernote-library'); if (!raw) return; const entries = JSON.parse(raw) as {workspace: WorkspaceData}[]; for (const entry of entries) { if (!entry.workspace.id) entry.workspace.id=generateId(); await saveRecovery(entry.workspace); } localStorage.removeItem('powernote-library'); }
export async function recoveryStats(): Promise<{count:number; bytes:number}> { const e=await listRecovery(); return {count:e.length,bytes:e.reduce((n,x)=>n+x.bytes,0)}; }
