export interface Trench {
  id: string;
  name: string; // 探方编号，如 T0203
  depth: number; // 探方总深度（米）
  createdAt: string;
}

export interface Layer {
  id: string;
  trenchId: string;
  name: string; // 层名，如 第1层
  soilColor: string; // 土色
  topDepth: number; // 顶深（米），必须承接上层层底
  bottomDepth: number; // 底深（米），不得超出探方深度
  closed: boolean; // 是否已闭合；未闭合地层不得登记出土物
  createdAt: string;
}

export interface Coordinate {
  e: number; // 东向坐标
  n: number; // 北向坐标
  depth: number; // 埋藏深度（米，自地表向下）
}

export interface Specimen {
  id: string;
  trenchId: string;
  layerId: string;
  specimenNo: string; // 标本编号，探方内唯一
  name: string; // 出土物名称
  coord: Coordinate; // 坐标点，同一探方内唯一
  count: number; // 件数
  frozen: boolean; // 移交后冻结坐标与件数
  handedOverAt: string | null;
  createdAt: string;
}

export type RevisionField = "坐标" | "件数";

export interface RevisionChange {
  field: RevisionField;
  oldValue: string; // 原值（永久保留）
  newValue: string; // 新值
}

export interface Revision {
  id: string;
  specimenId: string;
  reason: string; // 修订原因（必填）
  changes: RevisionChange[];
  createdAt: string;
}

export interface Conflict {
  id: string;
  message: string;
  trenchName: string; // 探方
  layerName: string; // 地层
  coordinate: string; // 坐标
  oldValue: string; // 原值
  newValue: string; // 新值
  createdAt: string;
}

export interface Store {
  version: 1;
  trenches: Trench[];
  layers: Layer[];
  specimens: Specimen[];
  revisions: Revision[];
  conflicts: Conflict[];
  selectedTrenchId: string | null;
}
