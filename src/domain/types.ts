// 数据层：领域模型
// 只描述结构，不包含任何规则判断与界面代码。

export type Distribution = 'internal' | 'external';
export type DepRisk = 'ok' | 'warn' | 'risk';
export type NotificationKind =
  | 'unapproved-candidate' // 未审核候选版本
  | 'review-required' // 许可证 / 版权声明 / 来源发生变化，进入复核
  | 'gpl-external' // GPL 系由内部使用升级为对外分发，缺少法务授权
  | 'conflict'; // 刷新校验命中冲突

/** 依赖上的一条引用记录（同一路径可被多次引用） */
export interface PathRef {
  id: string;
  path: string;
  scope: Distribution; // 该引用的用途：内部使用 / 对外分发
  note?: string;
  addedAt: number;
  removedAt?: number; // 软删除：最后一条引用移除后义务才收回
}

/** 候选升级版本（扫描发现，未审核前不得替换当前版本） */
export interface Candidate {
  version: string;
  license: string;
  copyright: string;
  source: string;
  note?: string;
  detectedAt: number;
  reviewed: boolean;
  reviewedAt?: number;
  reviewedBy?: string;
}

/** 已登记的版本记录（当前版本、历史版本、补录版本都在这里留痕） */
export interface VersionRecord {
  version: string;
  license: string;
  copyright: string;
  source: string;
  reviewed: boolean;
  reviewedAt?: number;
  reviewedBy?: string;
  note?: string;
  /** 补录版本：另建一条并强制带原因，不覆盖既有记录 */
  backfill?: boolean;
  backfillReason?: string;
  withdrawnAt?: number; // 被撤回的时间戳
}

export interface Dep {
  id: number;
  name: string;
  currentVersion: string;
  versions: Record<string, VersionRecord>;
  /** 历次当前版本栈（最近在末尾），撤回时只回退到最近的已审核版本 */
  history: string[];
  candidates: Candidate[];
  paths: PathRef[];
  createdAt: number;
}

/** GPL 系对外分发法务授权：绑定依赖 + 版本 + 覆盖的引用路径 */
export interface Authorization {
  id: string;
  depId: number;
  version: string;
  coveredPathIds: string[];
  approver: string;
  approvedAt: number;
  note?: string;
  revoked?: boolean;
  revokedAt?: number;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  depId: number;
  depName: string;
  version?: string;
  pathId?: string;
  path?: string;
  title: string;
  detail: string;
  createdAt: number;
}

/** 冻结批次内的快照项：冻结后不再随当前状态变化 */
export interface BatchSnapshotItem {
  depId: number;
  depName: string;
  version: string;
  license: string;
  path: string;
  kind: NotificationKind;
  title: string;
  detail: string;
}

export interface Batch {
  id: string;
  number: number;
  createdAt: number;
  frozen: true;
  items: BatchSnapshotItem[]; // 冻结时的快照，不可变
  note?: string;
}

/** 刷新校验得到的冲突行：依赖 / 旧新许可证 / 引用路径 / 命中规则 */
export interface Conflict {
  id: string;
  depId: number;
  depName: string;
  oldLicense: string;
  newLicense: string;
  path: string;
  ruleCode: string;
  rule: string;
  severity: DepRisk;
  detail: string;
}

export interface AppState {
  deps: Dep[];
  authorizations: Authorization[];
  queue: NotificationItem[]; // 待处理通知（活清单）
  batches: Batch[]; // 已冻结批次（不可变）
  batchSeq: number;
  conflicts: Conflict[];
  lastRefreshedAt: number;
}
