import { invoke, isTauri } from "@tauri-apps/api/core";

// Only completed transactions enter this set. A lost reply must never release an active write.
const pendingReleases = new Set<string>();
const releasing = new Map<string, Promise<void>>();
function release(id: string) {
  const existing = releasing.get(id);
  if (existing) return existing;
  const work = invoke<void>("release_backup_draft", { id }).then(() => {
    pendingReleases.delete(id);
  }).finally(() => { releasing.delete(id); });
  releasing.set(id, work);
  return work;
}
export async function settleBackupDraftLeases() {
  if (!isTauri()) return;
  for (const id of [...pendingReleases]) await release(id);
}
/** The desktop close path waits for the actual IndexedDB transaction. */
export async function withBackupDraftSave<T>(save: () => Promise<T>): Promise<T> {
  if (!isTauri()) return save();
  await settleBackupDraftLeases();
  const id = crypto.randomUUID();
  try {
    await invoke("hold_backup_draft", { id });
  } catch (error) {
    // The native hold may have succeeded even if its reply was lost.
    pendingReleases.add(id);
    await release(id).catch(() => {});
    if (/not found|unknown command|不存在/i.test(String(error))) {
      pendingReleases.delete(id);
      return save();
    }
    throw error;
  }
  try {
    return await save();
  } finally {
    pendingReleases.add(id);
    await release(id);
  }
}
