// 数据层：类型定义。只描述结构，不含规则与界面逻辑。

export type UsageKind = 'internal' | 'external'; // 内部使用 / 对外分发
export type ReviewVerdict = 'pending' | 'approved' | 'rejected';
export type ChangeKind =
  | 'license'
  | 'copyright'
  | 'source'
  | 'usage'
  | 'version';

/** 引用：一个引用路径（相对项目根目录） */
export interface RefPath {
  path: string;
  count: number; // 同一文件内可能多次引用，去重后仍保留引用次数
}

/** 某一时刻的依赖快照：版本与义务元数据 */
export interface DepSnapshot {
  version: string;
  license: string;
  copyright: string; // 版权声明
  source: string; // 来源，如 npm / 手动
  usage: UsageKind;
}

/** 审核记录（针对候选版本） */
export interface Review {
  version: string;
  verdict: ReviewVerdict;
  changed: ChangeKind[]; // 与当前版本相比的差异项
  authorizer?: string; // 审核人 / 法务
  reason?: string; // 拒绝原因等
  reviewedAt?: string;
}

/** 已审核版本记录：撤回时按此回退 */
export interface ApprovedVersion extends DepSnapshot {
  approvedAt: string;
}

/** 法务授权：GPL 系由内部使用升级为对外分发时必须覆盖引用路径 */
export interface LegalGrant {
  id: string;
  ref: string; // 授权文号，如 LEGAL-2026-007
  scopePaths: string[]; // 授权覆盖的引用路径
  approvedAt: string;
  active: boolean;
}

export interface Dep {
  id: number;
  name: string;
  // 当前版本 = 已审核并替换上一版本后的生效版本，未审核候选不得替换
  current: DepSnapshot;
  candidate: (DepSnapshot & { proposedAt: string }) | null;
  refs: RefPath[]; // 引用路径（按路径去重）
  review: Review | null; // 当前候选的审核结论
  grants: LegalGrant[]; // 法务授权
  approvedVersions: ApprovedVersion[]; // 已审核版本链，撤回只回退最近一份
}

export type BatchStatus = 'frozen' | 'withdrawn' | 'superseded';

/** 通知批次：创建即冻结，补录另建带原因的新版本 */
export interface NoticeBatchItem {
  depId: number;
  name: string;
  version: string;
  license: string;
  changeSummary: string;
}
export interface NoticeBatch {
  id: string;
  seq: number; // 批次序号
  parentId: string | null; // 补录版本指向原批次
  supplementReason: string | null;
  status: BatchStatus;
  frozenAt: string;
  items: NoticeBatchItem[];
}

export interface ComplianceState {
  deps: Dep[];
  batches: NoticeBatch[];
  seq: number;
}

/** 刷新后检出的冲突：依赖、旧新许可证、引用路径、命中规则 */
export interface Conflict {
  id: string;
  depId: number;
  depName: string;
  rule: string; // 命中规则编号
  title: string;
  detail: string;
  oldLicense: string;
  newLicense: string;
  refPaths: string[];
}
