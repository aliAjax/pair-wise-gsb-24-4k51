// 落盘层：档案持久化到 localStorage，载入时先做一致性校验（reconcile），
// 修复结果立即回写，保证刷新后探方、地层、出土物与修订链一致。

import { reconcile, seedArchive } from "./domain";
import type { Archive, Conflict } from "./domain";

export const STORAGE_KEY = "hxwl-10/archive/v1";

export function persist(archive: Archive): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
  } catch {
    // 存储不可用（隐私模式/配额）时静默降级为内存态
  }
}

export function loadArchive(): { archive: Archive; conflicts: Conflict[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = seedArchive();
      persist(seed);
      return { archive: seed, conflicts: [] };
    }
    const parsed = JSON.parse(raw) as Archive;
    const { archive, conflicts } = reconcile(parsed);
    if (conflicts.length > 0) persist(archive); // 回滚结果落盘
    return { archive, conflicts };
  } catch {
    const seed = seedArchive();
    persist(seed);
    return { archive: seed, conflicts: [] };
  }
}

export function resetArchive(): Archive {
  const seed = seedArchive();
  persist(seed);
  return seed;
}
