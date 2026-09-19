// 领域模型与闭环规则：探方 → 地层 → 出土物 → 移交冻结 → 修订链。
// 所有约束在此集中强制，UI 操作与落盘校验（reconcile）共用同一套规则。

export interface Coord {
  x: number; // 东坐标 E
  y: number; // 北坐标 N
}

export interface Square {
  id: string;
  name: string; // 探方编号，如 T0203
  depth: number; // 探方深度（cm）
}

export interface Layer {
  id: string;
  squareId: string;
  name: string;
  soil: string;
  topDepth: number; // 顶深：必须承接上层层底
  bottomDepth: number; // 底深：不得超出探方深度
  closed: boolean; // 闭合后才允许登记出土物
  closedAt: string | null;
}

export interface Artifact {
  id: string;
  squareId: string;
  layerId: string;
  specimenNo: string; // 标本编号：同一探方内同一坐标共用一个编号
  name: string;
  coord: Coord;
  count: number; // 件数
  merged: boolean; // 是否因坐标重复而归并
  createdAt: string;
}

export interface Handover {
  id: string;
  artifactId: string;
  coord: Coord; // 移交时冻结的坐标
  count: number; // 移交时冻结的件数
  at: string;
}

export interface Revision {
  id: string;
  artifactId: string;
  reason: string; // 更正原因（必填）
  original: { coord: Coord; count: number }; // 原值：始终等于移交冻结值
  next: { coord: Coord; count: number }; // 新值：本次更正值
  at: string;
}

export interface Archive {
  squares: Square[];
  layers: Layer[];
  artifacts: Artifact[];
  handovers: Handover[];
  revisions: Revision[];
}

export interface Conflict {
  kind: string; // 冲突类型
  square: string; // 探方
  layer: string; // 地层
  coord: string; // 坐标
  original: string; // 原值（保留）
  next: string; // 新值（回滚）
}

// ---------------------------------------------------------------- 工具

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export const fmtCoord = (c: Coord) => `E${c.x} N${c.y}`;
const coordKey = (c: Coord) => `${c.x}|${c.y}`;
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y;

export function layersOf(archive: Archive, squareId: string): Layer[] {
  return archive.layers
    .filter((l) => l.squareId === squareId)
    .sort((a, b) => a.topDepth - b.topDepth);
}

export function handoverOf(archive: Archive, artifactId: string): Handover | null {
  return archive.handovers.find((h) => h.artifactId === artifactId) ?? null;
}

export function revisionsOf(archive: Archive, artifactId: string): Revision[] {
  return archive.revisions
    .filter((r) => r.artifactId === artifactId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** 已冻结出土物的应有当前值：最新修订的新值，无修订则为冻结值。 */
export function expectedValues(
  archive: Archive,
  artifactId: string
): { coord: Coord; count: number } | null {
  const ho = handoverOf(archive, artifactId);
  if (!ho) return null;
  const revs = revisionsOf(archive, artifactId);
  const last = revs[revs.length - 1];
  return last
    ? { coord: { ...last.next.coord }, count: last.next.count }
    : { coord: { ...ho.coord }, count: ho.count };
}

function checkCoord(coord: Coord) {
  if (!Number.isFinite(coord.x) || !Number.isFinite(coord.y) || coord.x < 0 || coord.y < 0) {
    throw new Error("坐标必须为非负数值");
  }
}

function checkCount(count: number) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("件数必须为不小于 1 的整数");
  }
}

function nextSpecimenNo(archive: Archive, squareName: string): string {
  let max = 0;
  for (const a of archive.artifacts) {
    const m = a.specimenNo.match(/^(.+)-(\d+)$/);
    if (m && m[1] === squareName) max = Math.max(max, parseInt(m[2], 10));
  }
  return `${squareName}-${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------- 操作（均为纯函数，失败抛错）

export function addSquare(archive: Archive, name: string, depth: number): Archive {
  const n = name.trim();
  if (!n) throw new Error("探方编号不能为空");
  if (archive.squares.some((s) => s.name === n)) throw new Error(`探方 ${n} 已存在`);
  if (!Number.isFinite(depth) || depth <= 0) throw new Error("探方深度必须大于 0");
  const next = structuredClone(archive);
  next.squares.push({ id: uid("sq"), name: n, depth });
  return next;
}

/** 新增地层：顶深强制承接上层层底，底深不得超出探方深度。 */
export function addLayer(
  archive: Archive,
  squareId: string,
  name: string,
  soil: string,
  bottomDepth: number
): Archive {
  const square = archive.squares.find((s) => s.id === squareId);
  if (!square) throw new Error("探方不存在");
  const layers = layersOf(archive, squareId);
  const top = layers.length ? layers[layers.length - 1].bottomDepth : 0;
  if (!Number.isFinite(bottomDepth)) throw new Error("请填写底深");
  if (bottomDepth <= top) throw new Error(`底深必须大于承接顶深 ${top}cm`);
  if (bottomDepth > square.depth) throw new Error(`底深不得超出探方深度 ${square.depth}cm`);
  const next = structuredClone(archive);
  next.layers.push({
    id: uid("ly"),
    squareId,
    name: name.trim() || `第${layers.length + 1}层`,
    soil: soil.trim() || "未记录",
    topDepth: top,
    bottomDepth,
    closed: false,
    closedAt: null,
  });
  return next;
}

export function closeLayer(archive: Archive, layerId: string): Archive {
  const next = structuredClone(archive);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error("地层不存在");
  if (layer.closed) throw new Error("地层已闭合");
  layer.closed = true;
  layer.closedAt = new Date().toISOString();
  return next;
}

/** 登记出土物：仅限已闭合地层；同一探方内坐标重复时归并到同一标本编号。 */
export function registerArtifact(
  archive: Archive,
  layerId: string,
  name: string,
  coord: Coord,
  count: number
): { archive: Archive; artifact: Artifact; mergedWith: Artifact | null } {
  const layer = archive.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error("地层不存在");
  if (!layer.closed) throw new Error("未闭合地层不得登记出土物");
  checkCoord(coord);
  checkCount(count);
  const next = structuredClone(archive);
  const square = next.squares.find((s) => s.id === layer.squareId);
  if (!square) throw new Error("探方不存在");
  const dup = next.artifacts.find(
    (a) => a.squareId === layer.squareId && coordKey(a.coord) === coordKey(coord)
  );
  const specimenNo = dup ? dup.specimenNo : nextSpecimenNo(next, square.name);
  const artifact: Artifact = {
    id: uid("ar"),
    squareId: layer.squareId,
    layerId,
    specimenNo,
    name: name.trim() || "未命名",
    coord: { ...coord },
    count,
    merged: Boolean(dup),
    createdAt: new Date().toISOString(),
  };
  next.artifacts.push(artifact);
  return { archive: next, artifact, mergedWith: dup ?? null };
}

/** 移交：冻结坐标与件数。 */
export function handoverArtifact(archive: Archive, artifactId: string): Archive {
  const artifact = archive.artifacts.find((a) => a.id === artifactId);
  if (!artifact) throw new Error("出土物不存在");
  if (handoverOf(archive, artifactId)) throw new Error("该出土物已移交冻结");
  const next = structuredClone(archive);
  next.handovers.push({
    id: uid("ho"),
    artifactId,
    coord: { ...artifact.coord },
    count: artifact.count,
    at: new Date().toISOString(),
  });
  return next;
}

/** 更正：只能新建带原因的修订，原值保留为移交冻结值。 */
export function reviseArtifact(
  archive: Archive,
  artifactId: string,
  next: { coord: Coord; count: number },
  reason: string
): Archive {
  const artifact = archive.artifacts.find((a) => a.id === artifactId);
  if (!artifact) throw new Error("出土物不存在");
  const ho = handoverOf(archive, artifactId);
  if (!ho) throw new Error("出土物未移交冻结，无需更正");
  if (!reason.trim()) throw new Error("更正必须填写原因");
  checkCoord(next.coord);
  checkCount(next.count);
  const dup = archive.artifacts.find(
    (a) =>
      a.id !== artifactId &&
      a.squareId === artifact.squareId &&
      a.specimenNo !== artifact.specimenNo &&
      coordKey(a.coord) === coordKey(next.coord)
  );
  if (dup) {
    throw new Error(
      `坐标 ${fmtCoord(next.coord)} 已登记在标本 ${dup.specimenNo} 下，同一探方内坐标重复只能归并到同一标本编号`
    );
  }
  const out = structuredClone(archive);
  out.revisions.push({
    id: uid("rv"),
    artifactId,
    reason: reason.trim(),
    original: { coord: { ...ho.coord }, count: ho.count },
    next: { coord: { ...next.coord }, count: next.count },
    at: new Date().toISOString(),
  });
  const target = out.artifacts.find((a) => a.id === artifactId);
  if (target) {
    target.coord = { ...next.coord };
    target.count = next.count;
  }
  return out;
}

// ---------------------------------------------------------------- 落盘一致性校验

/**
 * 载入时校验并修复：探方、地层、出土物与修订链保持一致。
 * 冲突一律以原值为准回滚，并逐条列出（探方、地层、坐标、原值、新值）。
 */
export function reconcile(input: Archive): { archive: Archive; conflicts: Conflict[] } {
  const archive = structuredClone(input);
  const conflicts: Conflict[] = [];
  const squareName = (id: string) =>
    archive.squares.find((s) => s.id === id)?.name ?? "未知探方";
  const layerName = (id: string) =>
    archive.layers.find((l) => l.id === id)?.name ?? "未知地层";

  // 1) 地层必须挂在存在的探方下
  archive.layers = archive.layers.filter((l) => {
    if (archive.squares.some((s) => s.id === l.squareId)) return true;
    conflicts.push({
      kind: "地层所属探方缺失",
      square: "未知探方",
      layer: l.name,
      coord: "—",
      original: "（已移除）",
      next: `${l.name} ${l.topDepth}–${l.bottomDepth}cm`,
    });
    return false;
  });

  // 2) 地层链：顶深承接上层层底，底深不得超出探方深度
  for (const square of archive.squares) {
    let expectedTop = 0;
    for (const layer of layersOf(archive, square.id)) {
      if (layer.topDepth !== expectedTop) {
        conflicts.push({
          kind: "地层顶深未承接",
          square: square.name,
          layer: layer.name,
          coord: "—",
          original: `顶深 ${expectedTop}cm`,
          next: `顶深 ${layer.topDepth}cm`,
        });
        layer.topDepth = expectedTop;
      }
      if (layer.bottomDepth > square.depth) {
        conflicts.push({
          kind: "地层底深超出探方",
          square: square.name,
          layer: layer.name,
          coord: "—",
          original: `底深 ${square.depth}cm`,
          next: `底深 ${layer.bottomDepth}cm`,
        });
        layer.bottomDepth = square.depth;
      }
      if (layer.bottomDepth < layer.topDepth) {
        conflicts.push({
          kind: "地层底深倒挂",
          square: square.name,
          layer: layer.name,
          coord: "—",
          original: `底深 ${layer.topDepth}cm`,
          next: `底深 ${layer.bottomDepth}cm`,
        });
        layer.bottomDepth = layer.topDepth;
      }
      expectedTop = layer.bottomDepth;
    }
  }

  // 3) 出土物：归属必须存在；未闭合地层不得登记出土物
  archive.artifacts = archive.artifacts.filter((a) => {
    const layer = archive.layers.find((l) => l.id === a.layerId);
    const squareOk = archive.squares.some((s) => s.id === a.squareId);
    if (!layer || !squareOk) {
      conflicts.push({
        kind: "出土物归属缺失",
        square: squareName(a.squareId),
        layer: layerName(a.layerId),
        coord: fmtCoord(a.coord),
        original: "（已移除）",
        next: `${a.specimenNo} · ${a.count}件`,
      });
      return false;
    }
    if (!layer.closed) {
      conflicts.push({
        kind: "未闭合地层登记",
        square: squareName(a.squareId),
        layer: layer.name,
        coord: fmtCoord(a.coord),
        original: "（已移除）",
        next: `${a.specimenNo} · ${a.count}件`,
      });
      return false;
    }
    return true;
  });

  // 4) 同一探方内坐标重复 → 归并到同一标本编号（以最早登记为准）
  const byCoord = new Map<string, Artifact[]>();
  for (const a of archive.artifacts) {
    const key = `${a.squareId}@${coordKey(a.coord)}`;
    const group = byCoord.get(key) ?? [];
    group.push(a);
    byCoord.set(key, group);
  }
  for (const group of byCoord.values()) {
    if (new Set(group.map((a) => a.specimenNo)).size <= 1) continue;
    group.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const canonical = group[0].specimenNo;
    for (const a of group) {
      if (a.specimenNo === canonical) continue;
      conflicts.push({
        kind: "坐标重复归并",
        square: squareName(a.squareId),
        layer: layerName(a.layerId),
        coord: fmtCoord(a.coord),
        original: canonical,
        next: a.specimenNo,
      });
      a.specimenNo = canonical;
      a.merged = true;
    }
  }

  // 5) 移交记录：每个出土物只保留最早一条；孤儿移交移除
  const seen = new Set<string>();
  archive.handovers = archive.handovers
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((h) => {
      if (!archive.artifacts.some((a) => a.id === h.artifactId)) {
        conflicts.push({
          kind: "移交记录无对应出土物",
          square: "—",
          layer: "—",
          coord: fmtCoord(h.coord),
          original: "（已移除）",
          next: `${h.count}件`,
        });
        return false;
      }
      if (seen.has(h.artifactId)) {
        conflicts.push({
          kind: "重复移交",
          square: "—",
          layer: "—",
          coord: fmtCoord(h.coord),
          original: "（保留最早移交）",
          next: `${h.count}件`,
        });
        return false;
      }
      seen.add(h.artifactId);
      return true;
    });

  // 6) 修订链：必须挂在已移交的出土物上；原值必须等于冻结值
  archive.revisions = archive.revisions.filter((r) => {
    const artifact = archive.artifacts.find((a) => a.id === r.artifactId);
    const ho = archive.handovers.find((h) => h.artifactId === r.artifactId);
    if (!artifact || !ho) {
      conflicts.push({
        kind: "修订无对应冻结",
        square: artifact ? squareName(artifact.squareId) : "—",
        layer: artifact ? layerName(artifact.layerId) : "—",
        coord: fmtCoord(r.next.coord),
        original: "（已移除）",
        next: r.reason,
      });
      return false;
    }
    if (!sameCoord(r.original.coord, ho.coord) || r.original.count !== ho.count) {
      conflicts.push({
        kind: "修订原值失真",
        square: squareName(artifact.squareId),
        layer: layerName(artifact.layerId),
        coord: fmtCoord(ho.coord),
        original: `${fmtCoord(ho.coord)} · ${ho.count}件`,
        next: `${fmtCoord(r.original.coord)} · ${r.original.count}件`,
      });
      r.original = { coord: { ...ho.coord }, count: ho.count };
    }
    return true;
  });

  // 7) 已冻结出土物：当前值必须等于 冻结值/最新修订值
  for (const ho of archive.handovers) {
    const artifact = archive.artifacts.find((a) => a.id === ho.artifactId);
    if (!artifact) continue;
    const expected = expectedValues(archive, artifact.id);
    if (!expected) continue;
    if (!sameCoord(artifact.coord, expected.coord) || artifact.count !== expected.count) {
      conflicts.push({
        kind: "冻结值被改动",
        square: squareName(artifact.squareId),
        layer: layerName(artifact.layerId),
        coord: fmtCoord(expected.coord),
        original: `${fmtCoord(expected.coord)} · ${expected.count}件`,
        next: `${fmtCoord(artifact.coord)} · ${artifact.count}件`,
      });
      artifact.coord = { ...expected.coord };
      artifact.count = expected.count;
    }
  }

  return { archive, conflicts };
}

// ---------------------------------------------------------------- 示例数据

export function seedArchive(): Archive {
  const t = (day: string) => `2026-09-${day}T08:30:00.000Z`;
  return {
    squares: [
      { id: "sq-t0203", name: "T0203", depth: 120 },
      { id: "sq-t0204", name: "T0204", depth: 90 },
    ],
    layers: [
      { id: "ly-1", squareId: "sq-t0203", name: "第1层", soil: "灰褐土", topDepth: 0, bottomDepth: 35, closed: true, closedAt: t("10") },
      { id: "ly-2", squareId: "sq-t0203", name: "第2层", soil: "黄褐土", topDepth: 35, bottomDepth: 70, closed: true, closedAt: t("12") },
      { id: "ly-3", squareId: "sq-t0203", name: "第3层", soil: "红褐土", topDepth: 70, bottomDepth: 120, closed: false, closedAt: null },
      { id: "ly-4", squareId: "sq-t0204", name: "第1层", soil: "黑褐土", topDepth: 0, bottomDepth: 40, closed: true, closedAt: t("11") },
    ],
    artifacts: [
      { id: "ar-1", squareId: "sq-t0203", layerId: "ly-1", specimenNo: "T0203-001", name: "陶片", coord: { x: 3, y: 4 }, count: 12, merged: false, createdAt: t("10") },
      { id: "ar-2", squareId: "sq-t0203", layerId: "ly-1", specimenNo: "T0203-002", name: "兽骨", coord: { x: 5, y: 2 }, count: 3, merged: false, createdAt: t("10") },
      // 与 ar-1 同探方同坐标，归并到同一标本编号
      { id: "ar-3", squareId: "sq-t0203", layerId: "ly-2", specimenNo: "T0203-001", name: "陶片", coord: { x: 3, y: 4 }, count: 2, merged: true, createdAt: t("12") },
      // 已移交冻结 1 件，后经修订更正为 2 件
      { id: "ar-4", squareId: "sq-t0204", layerId: "ly-4", specimenNo: "T0204-001", name: "石斧", coord: { x: 1, y: 1 }, count: 2, merged: false, createdAt: t("11") },
    ],
    handovers: [
      { id: "ho-1", artifactId: "ar-1", coord: { x: 3, y: 4 }, count: 12, at: t("13") },
      { id: "ho-2", artifactId: "ar-4", coord: { x: 1, y: 1 }, count: 1, at: t("13") },
    ],
    revisions: [
      {
        id: "rv-1",
        artifactId: "ar-4",
        reason: "库房复核发现两件粘连，按两件计",
        original: { coord: { x: 1, y: 1 }, count: 1 },
        next: { coord: { x: 1, y: 1 }, count: 2 },
        at: t("14"),
      },
    ],
  };
}
