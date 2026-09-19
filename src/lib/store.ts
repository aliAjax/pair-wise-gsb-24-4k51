import type {
  Conflict,
  Coordinate,
  Layer,
  Revision,
  RevisionChange,
  Specimen,
  Store,
  Trench,
} from "../types";

export const STORAGE_KEY = "hxwl-10-archive-v1";

let uidCounter = 0;

export function uid(prefix: string): string {
  uidCounter += 1;
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}-${rand}`;
}

export function now(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

/** 统一保留两位小数，避免浮点误差破坏坐标/深度比较 */
export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function fmtDepth(v: number): string {
  return `${v.toFixed(2)}m`;
}

export function fmtCoord(c: Coordinate): string {
  return `E${c.e.toFixed(2)} N${c.n.toFixed(2)} 深${c.depth.toFixed(2)}m`;
}

export function coordKey(c: Coordinate): string {
  return `${c.e.toFixed(2)}|${c.n.toFixed(2)}|${c.depth.toFixed(2)}`;
}

export interface AppEvent {
  kind: "ok" | "conflict";
  text: string;
}

export type Action =
  | { type: "add-trench"; name: string; depth: number }
  | { type: "select-trench"; trenchId: string }
  | { type: "add-layer"; trenchId: string; name: string; soilColor: string; bottomDepth: number }
  | { type: "close-layer"; layerId: string }
  | {
      type: "register-artifact";
      trenchId: string;
      layerId: string;
      name: string;
      coord: Coordinate;
      count: number;
      specimenNo: string;
    }
  | { type: "handover-specimen"; specimenId: string }
  | { type: "handover-trench"; trenchId: string }
  | {
      type: "correct-specimen";
      specimenId: string;
      name: string;
      coord: Coordinate;
      count: number;
      reason: string;
    }
  | { type: "clear-conflicts" }
  | { type: "import-store"; store: Store }
  | { type: "reset" };

interface Result {
  store: Store;
  event: AppEvent | null;
}

function ok(store: Store, text: string): Result {
  return { store, event: { kind: "ok", text } };
}

function noop(store: Store): Result {
  return { store, event: null };
}

/** 冲突落账：探方、地层、坐标、原值、新值五要素齐全 */
function fail(store: Store, c: Omit<Conflict, "id" | "createdAt">): Result {
  const conflict: Conflict = { ...c, id: uid("cf"), createdAt: now() };
  return {
    store: { ...store, conflicts: [conflict, ...store.conflicts].slice(0, 100) },
    event: { kind: "conflict", text: c.message },
  };
}

function nextSpecimenNo(trench: Trench, specimens: Specimen[]): string {
  const used = new Set(specimens.map((s) => s.specimenNo));
  let i = specimens.length + 1;
  let no = `${trench.name}-${String(i).padStart(3, "0")}`;
  while (used.has(no)) {
    i += 1;
    no = `${trench.name}-${String(i).padStart(3, "0")}`;
  }
  return no;
}

export function applyAction(store: Store, action: Action): Result {
  switch (action.type) {
    case "add-trench": {
      const name = action.name.trim();
      const depth = r2(action.depth);
      if (!name) {
        return fail(store, {
          message: "探方编号不能为空",
          trenchName: "（未填写）",
          layerName: "—",
          coordinate: "—",
          oldValue: "—",
          newValue: "新建探方",
        });
      }
      if (store.trenches.some((t) => t.name === name)) {
        return fail(store, {
          message: "探方编号已存在，不能重复建立",
          trenchName: name,
          layerName: "—",
          coordinate: "—",
          oldValue: "已存在的探方",
          newValue: "新建同名探方",
        });
      }
      if (!Number.isFinite(depth) || depth <= 0) {
        return fail(store, {
          message: "探方深度必须大于 0",
          trenchName: name,
          layerName: "—",
          coordinate: "—",
          oldValue: "深度 > 0",
          newValue: `${action.depth}`,
        });
      }
      const trench: Trench = { id: uid("tr"), name, depth, createdAt: now() };
      return ok(
        { ...store, trenches: [...store.trenches, trench], selectedTrenchId: trench.id },
        `探方 ${name} 已建立（深度 ${fmtDepth(depth)}）`
      );
    }

    case "select-trench": {
      return { store: { ...store, selectedTrenchId: action.trenchId }, event: null };
    }

    case "add-layer": {
      const trench = store.trenches.find((t) => t.id === action.trenchId);
      if (!trench) return noop(store);
      const trenchLayers = store.layers.filter((l) => l.trenchId === trench.id);
      // 新地层顶深强制承接上层层底（已有层最大底深），首层为 0
      const top = r2(trenchLayers.reduce((m, l) => Math.max(m, l.bottomDepth), 0));
      const bottom = r2(action.bottomDepth);
      const name = action.name.trim() || `第${trenchLayers.length + 1}层`;
      const soilColor = action.soilColor.trim() || "未记录";
      if (!Number.isFinite(bottom) || bottom <= top) {
        return fail(store, {
          message: "新地层顶深必须承接上层层底，底深须大于顶深",
          trenchName: trench.name,
          layerName: name,
          coordinate: `顶深 ${fmtDepth(top)}`,
          oldValue: `上层层底 ${fmtDepth(top)}`,
          newValue: `底深 ${fmtDepth(bottom)}`,
        });
      }
      if (bottom > trench.depth) {
        return fail(store, {
          message: "新地层底深超出探方深度",
          trenchName: trench.name,
          layerName: name,
          coordinate: `顶深 ${fmtDepth(top)}`,
          oldValue: `探方深度 ${fmtDepth(trench.depth)}`,
          newValue: `底深 ${fmtDepth(bottom)}`,
        });
      }
      const layer: Layer = {
        id: uid("ly"),
        trenchId: trench.id,
        name,
        soilColor,
        topDepth: top,
        bottomDepth: bottom,
        closed: false,
        createdAt: now(),
      };
      return ok(
        { ...store, layers: [...store.layers, layer] },
        `地层 ${trench.name}·${name} 已登记（${fmtDepth(top)}–${fmtDepth(bottom)}），闭合后方可登记出土物`
      );
    }

    case "close-layer": {
      const layer = store.layers.find((l) => l.id === action.layerId);
      if (!layer || layer.closed) return noop(store);
      const trench = store.trenches.find((t) => t.id === layer.trenchId);
      const layers = store.layers.map((l) => (l.id === layer.id ? { ...l, closed: true } : l));
      return ok(
        { ...store, layers },
        `地层 ${trench?.name ?? ""}·${layer.name} 已闭合，可登记出土物`
      );
    }

    case "register-artifact": {
      const trench = store.trenches.find((t) => t.id === action.trenchId);
      const layer = store.layers.find((l) => l.id === action.layerId);
      if (!trench || !layer || layer.trenchId !== trench.id) return noop(store);
      const name = action.name.trim();
      const coord: Coordinate = {
        e: r2(action.coord.e),
        n: r2(action.coord.n),
        depth: r2(action.coord.depth),
      };
      const coordStr = fmtCoord(coord);
      const count = action.count;
      const inputNo = action.specimenNo.trim();
      if (!name) {
        return fail(store, {
          message: "出土物名称不能为空",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: coordStr,
          oldValue: "—",
          newValue: "（未填写）",
        });
      }
      if (
        !Number.isFinite(coord.e) ||
        !Number.isFinite(coord.n) ||
        !Number.isFinite(coord.depth)
      ) {
        return fail(store, {
          message: "坐标必须为数字",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: coordStr,
          oldValue: "数字坐标",
          newValue: `E${action.coord.e} N${action.coord.n} 深${action.coord.depth}`,
        });
      }
      // 未闭合地层不得登记出土物
      if (!layer.closed) {
        return fail(store, {
          message: "未闭合地层不得登记出土物",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: coordStr,
          oldValue: "地层状态：未闭合",
          newValue: `登记《${name}》`,
        });
      }
      if (coord.depth < layer.topDepth || coord.depth > layer.bottomDepth) {
        return fail(store, {
          message: "出土物深度超出所属地层范围",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: coordStr,
          oldValue: `层位 ${fmtDepth(layer.topDepth)}–${fmtDepth(layer.bottomDepth)}`,
          newValue: `深 ${fmtDepth(coord.depth)}`,
        });
      }
      if (!Number.isInteger(count) || count < 1) {
        return fail(store, {
          message: "件数必须为不小于 1 的整数",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: coordStr,
          oldValue: "件数 ≥ 1",
          newValue: `${count}`,
        });
      }
      const trenchSpecimens = store.specimens.filter((s) => s.trenchId === trench.id);
      const existing = trenchSpecimens.find((s) => coordKey(s.coord) === coordKey(coord));
      if (existing) {
        // 同一探方内坐标重复：只能归并到同一标本编号
        if (inputNo && inputNo !== existing.specimenNo) {
          return fail(store, {
            message: "坐标重复：同一探方内只能归并到同一标本编号",
            trenchName: trench.name,
            layerName: layer.name,
            coordinate: coordStr,
            oldValue: existing.specimenNo,
            newValue: inputNo,
          });
        }
        if (existing.frozen) {
          return fail(store, {
            message: "标本已移交冻结，件数归并被拒绝，请改用带原因的修订更正",
            trenchName: trench.name,
            layerName: layer.name,
            coordinate: coordStr,
            oldValue: `${existing.specimenNo} ${existing.count}件（已冻结）`,
            newValue: `归并后 ${existing.count + count}件`,
          });
        }
        const specimens = store.specimens.map((s) =>
          s.id === existing.id ? { ...s, count: s.count + count } : s
        );
        return ok(
          { ...store, specimens },
          `坐标重复，已归并至标本 ${existing.specimenNo}（累计 ${existing.count + count} 件）`
        );
      }
      if (inputNo) {
        const dup = trenchSpecimens.find((s) => s.specimenNo === inputNo);
        if (dup) {
          return fail(store, {
            message: "标本编号已被本探方其他坐标占用",
            trenchName: trench.name,
            layerName: layer.name,
            coordinate: coordStr,
            oldValue: `${inputNo} @ ${fmtCoord(dup.coord)}`,
            newValue: `${inputNo} @ ${coordStr}`,
          });
        }
      }
      const specimenNo = inputNo || nextSpecimenNo(trench, trenchSpecimens);
      const specimen: Specimen = {
        id: uid("sp"),
        trenchId: trench.id,
        layerId: layer.id,
        specimenNo,
        name,
        coord,
        count,
        frozen: false,
        handedOverAt: null,
        createdAt: now(),
      };
      return ok(
        { ...store, specimens: [...store.specimens, specimen] },
        `出土物已登记，标本编号 ${specimenNo}`
      );
    }

    case "handover-specimen": {
      const sp = store.specimens.find((s) => s.id === action.specimenId);
      if (!sp || sp.frozen) return noop(store);
      const specimens = store.specimens.map((s) =>
        s.id === sp.id ? { ...s, frozen: true, handedOverAt: now() } : s
      );
      return ok({ ...store, specimens }, `标本 ${sp.specimenNo} 已移交，坐标与件数已冻结`);
    }

    case "handover-trench": {
      const trench = store.trenches.find((t) => t.id === action.trenchId);
      if (!trench) return noop(store);
      const pending = store.specimens.filter((s) => s.trenchId === trench.id && !s.frozen);
      if (pending.length === 0) {
        return { store, event: { kind: "ok", text: `探方 ${trench.name} 没有待移交的标本` } };
      }
      const at = now();
      const specimens = store.specimens.map((s) =>
        s.trenchId === trench.id && !s.frozen ? { ...s, frozen: true, handedOverAt: at } : s
      );
      return ok(
        { ...store, specimens },
        `探方 ${trench.name} 的 ${pending.length} 件标本已移交，坐标与件数已冻结`
      );
    }

    case "correct-specimen": {
      const sp = store.specimens.find((s) => s.id === action.specimenId);
      if (!sp) return noop(store);
      const trench = store.trenches.find((t) => t.id === sp.trenchId);
      const layer = store.layers.find((l) => l.id === sp.layerId);
      if (!trench || !layer) return noop(store);
      const coord: Coordinate = {
        e: r2(action.coord.e),
        n: r2(action.coord.n),
        depth: r2(action.coord.depth),
      };
      const count = action.count;
      const name = action.name.trim() || sp.name;
      if (
        !Number.isFinite(coord.e) ||
        !Number.isFinite(coord.n) ||
        !Number.isFinite(coord.depth)
      ) {
        return fail(store, {
          message: "更正后的坐标必须为数字",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: fmtCoord(sp.coord),
          oldValue: fmtCoord(sp.coord),
          newValue: `E${action.coord.e} N${action.coord.n} 深${action.coord.depth}`,
        });
      }
      if (!Number.isInteger(count) || count < 1) {
        return fail(store, {
          message: "件数必须为不小于 1 的整数",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: fmtCoord(sp.coord),
          oldValue: `${sp.count}件`,
          newValue: `${count}`,
        });
      }
      if (coord.depth < layer.topDepth || coord.depth > layer.bottomDepth) {
        return fail(store, {
          message: "更正后的深度超出所属地层范围",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: fmtCoord(coord),
          oldValue: `层位 ${fmtDepth(layer.topDepth)}–${fmtDepth(layer.bottomDepth)}`,
          newValue: `深 ${fmtDepth(coord.depth)}`,
        });
      }
      const other = store.specimens.find(
        (s) => s.trenchId === sp.trenchId && s.id !== sp.id && coordKey(s.coord) === coordKey(coord)
      );
      if (other) {
        return fail(store, {
          message: "更正后的坐标与本探方其他标本重复",
          trenchName: trench.name,
          layerName: layer.name,
          coordinate: fmtCoord(coord),
          oldValue: `${other.specimenNo} 已占用该坐标`,
          newValue: `${sp.specimenNo} 迁入`,
        });
      }
      const changes: RevisionChange[] = [];
      if (coordKey(coord) !== coordKey(sp.coord)) {
        changes.push({ field: "坐标", oldValue: fmtCoord(sp.coord), newValue: fmtCoord(coord) });
      }
      if (count !== sp.count) {
        changes.push({ field: "件数", oldValue: `${sp.count}件`, newValue: `${count}件` });
      }
      if (changes.length === 0 && name === sp.name) {
        return { store, event: { kind: "ok", text: "没有需要更正的内容" } };
      }
      // 移交冻结后：坐标/件数的更正只能新建带原因的修订，原值入链保留
      if (sp.frozen && changes.length > 0) {
        const reason = action.reason.trim();
        if (!reason) {
          return fail(store, {
            message: "已移交冻结的标本，更正必须填写修订原因",
            trenchName: trench.name,
            layerName: layer.name,
            coordinate: fmtCoord(sp.coord),
            oldValue: changes.map((c) => `${c.field} ${c.oldValue}`).join("；"),
            newValue: changes.map((c) => `${c.field} ${c.newValue}`).join("；"),
          });
        }
        const revision: Revision = {
          id: uid("rv"),
          specimenId: sp.id,
          reason,
          changes,
          createdAt: now(),
        };
        const specimens = store.specimens.map((s) =>
          s.id === sp.id ? { ...s, coord, count, name } : s
        );
        return ok(
          { ...store, specimens, revisions: [...store.revisions, revision] },
          `已生成修订并保留原值：${changes
            .map((c) => `${c.field} ${c.oldValue} → ${c.newValue}`)
            .join("；")}`
        );
      }
      const specimens = store.specimens.map((s) =>
        s.id === sp.id ? { ...s, coord, count, name } : s
      );
      return ok(
        { ...store, specimens },
        changes.length === 0
          ? `标本 ${sp.specimenNo} 名称已更新`
          : `标本 ${sp.specimenNo} 已直接更正（未移交，无需修订）`
      );
    }

    case "clear-conflicts":
      return { store: { ...store, conflicts: [] }, event: null };

    case "import-store":
      return ok(action.store, "档案已导入，探方、地层、出土物与修订链已恢复");

    case "reset":
      return ok(seedStore(), "已重置为示例档案");

    default:
      return noop(store);
  }
}

export function seedStore(): Store {
  const t1: Trench = { id: "tr-t0203", name: "T0203", depth: 1.8, createdAt: now() };
  const t2: Trench = { id: "tr-t0204", name: "T0204", depth: 2.0, createdAt: now() };
  const t3: Trench = { id: "tr-t0301", name: "T0301", depth: 1.5, createdAt: now() };
  const layers: Layer[] = [
    { id: "ly-t0203-1", trenchId: t1.id, name: "第1层", soilColor: "灰褐土", topDepth: 0, bottomDepth: 0.35, closed: true, createdAt: now() },
    { id: "ly-t0203-2", trenchId: t1.id, name: "第2层", soilColor: "黄褐土", topDepth: 0.35, bottomDepth: 0.9, closed: true, createdAt: now() },
    { id: "ly-t0203-3", trenchId: t1.id, name: "第3层", soilColor: "灰褐土", topDepth: 0.9, bottomDepth: 1.5, closed: false, createdAt: now() },
    { id: "ly-t0204-1", trenchId: t2.id, name: "第1层", soilColor: "黑褐土", topDepth: 0, bottomDepth: 0.4, closed: true, createdAt: now() },
    { id: "ly-t0204-2", trenchId: t2.id, name: "H12灰坑填土", soilColor: "黑褐土夹炭屑", topDepth: 0.4, bottomDepth: 1.2, closed: false, createdAt: now() },
  ];
  const specimens: Specimen[] = [
    { id: "sp-t0203-001", trenchId: t1.id, layerId: "ly-t0203-2", specimenNo: "T0203-001", name: "陶片", coord: { e: 3, n: 4, depth: 0.5 }, count: 12, frozen: false, handedOverAt: null, createdAt: now() },
    { id: "sp-t0203-002", trenchId: t1.id, layerId: "ly-t0203-1", specimenNo: "T0203-002", name: "兽骨", coord: { e: 5.2, n: 2.4, depth: 0.25 }, count: 3, frozen: true, handedOverAt: now(), createdAt: now() },
    { id: "sp-t0204-001", trenchId: t2.id, layerId: "ly-t0204-1", specimenNo: "T0204-001", name: "动物骨骼", coord: { e: 1.5, n: 3.1, depth: 0.3 }, count: 5, frozen: false, handedOverAt: null, createdAt: now() },
  ];
  const revisions: Revision[] = [
    {
      id: "rv-t0203-002-1",
      specimenId: "sp-t0203-002",
      reason: "移交清点时漏记 1 件碎骨",
      changes: [{ field: "件数", oldValue: "2件", newValue: "3件" }],
      createdAt: now(),
    },
  ];
  return {
    version: 1,
    trenches: [t1, t2, t3],
    layers,
    specimens,
    revisions,
    conflicts: [],
    selectedTrenchId: t1.id,
  };
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.trenches)) {
        return parsed;
      }
    }
  } catch {
    // 落盘数据损坏时回退到示例档案
  }
  return seedStore();
}

export function persistStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用时仅保留内存态
  }
}
