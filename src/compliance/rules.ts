// 规则层：合规差异审查的全部判定逻辑。纯函数，不依赖 React 与界面。
import type {
  ApprovedVersion,
  ChangeKind,
  Conflict,
  Dep,
  DepSnapshot,
  LegalGrant,
  NoticeBatch,
  NoticeBatchItem,
  UsageKind,
} from './types';

// ---- 规则编号（冲突与复核原因统一引用，便于审计） ----
export const RULE = {
  LICENSE_CHANGE: 'R-LICENSE-CHANGE',
  COPYRIGHT_CHANGE: 'R-COPYRIGHT-CHANGE',
  SOURCE_CHANGE: 'R-SOURCE-CHANGE',
  USAGE_INTERNAL_TO_DISTRIBUTE: 'R-GPL-DISTRIBUTE-GRANT',
  GRANT_PATH_GAP: 'R-GRANT-PATH-GAP',
  CANDIDATE_UNAPPROVED: 'R-CANDIDATE-UNAPPROVED',
  BATCH_STALE: 'R-BATCH-STALE',
  REF_CHANGED: 'R-REF-CHANGED',
} as const;

const GPL_RE = /(^|-)(GPL|AGPL|LGPL)/i;
export const isGplFamily = (license: string): boolean => GPL_RE.test(license);

const now = (): string => new Date().toISOString();

// ---- 差异比较 ----
export interface CandidateDiff {
  changes: ChangeKind[];
  needsReview: boolean;
  reasons: string[];
}

/** 许可证 / 版权声明 / 来源任一变化即进入复核 */
export function diffCandidate(
  current: DepSnapshot,
  candidate: DepSnapshot,
): CandidateDiff {
  const changes: ChangeKind[] = [];
  const reasons: string[] = [];
  if (candidate.version !== current.version) changes.push('version');
  if (candidate.license !== current.license) {
    changes.push('license');
    reasons.push(
      `${RULE.LICENSE_CHANGE} 许可证 ${current.license} → ${candidate.license}`,
    );
  }
  if (candidate.copyright.trim() !== current.copyright.trim()) {
    changes.push('copyright');
    reasons.push(`${RULE.COPYRIGHT_CHANGE} 版权声明发生变化`);
  }
  if (candidate.source !== current.source) {
    changes.push('source');
    reasons.push(`${RULE.SOURCE_CHANGE} 来源 ${current.source} → ${candidate.source}`);
  }
  if (candidate.usage !== current.usage) {
    changes.push('usage');
    if (current.usage === 'internal' && candidate.usage === 'external') {
      reasons.push(
        `${RULE.USAGE_INTERNAL_TO_DISTRIBUTE} 使用范围由内部使用升级为对外分发`,
      );
    }
  }
  const needsReview =
    changes.includes('license') ||
    changes.includes('copyright') ||
    changes.includes('source') ||
    (changes.includes('usage') &&
      current.usage === 'internal' &&
      candidate.usage === 'external');
  return { changes, needsReview, reasons };
}

// ---- 引用路径：去重计数，最后引用移除后才收回义务 ----
export function addRef(dep: Dep, path: string): Dep {
  const p = path.trim();
  if (!p) return dep;
  const existing = dep.refs.find((r) => r.path === p);
  const refs = existing
    ? dep.refs.map((r) => (r.path === p ? { ...r, count: r.count + 1 } : r))
    : [...dep.refs, { path: p, count: 1 }];
  return { ...dep, refs };
}

export function removeRef(dep: Dep, path: string): Dep {
  const refs = dep.refs
    .map((r) => (r.path === path ? { ...r, count: r.count - 1 } : r))
    .filter((r) => r.count > 0); // 计数归零即最后引用移除，路径（义务）收回
  return { ...dep, refs };
}

// ---- 法务授权：GPL 系对外分发须绑定覆盖全部引用路径的授权 ----
export function activeGrants(dep: Dep): LegalGrant[] {
  return dep.grants.filter((g) => g.active);
}

export function coveredPaths(dep: Dep): Set<string> {
  return new Set(activeGrants(dep).flatMap((g) => g.scopePaths));
}

export function uncoveredRefPaths(dep: Dep): string[] {
  const covered = coveredPaths(dep);
  return dep.refs.map((r) => r.path).filter((p) => !covered.has(p));
}

/** GPL 由内部使用升级为对外分发时，授权必须覆盖全部引用路径 */
export function gplDistributeBlocked(
  current: DepSnapshot,
  target: DepSnapshot,
  dep: Dep,
): string[] {
  const blockers: string[] = [];
  const toExternal =
    current.usage === 'internal' && target.usage === 'external';
  if (isGplFamily(target.license) && (toExternal || target.usage === 'external')) {
    const grants = activeGrants(dep);
    if (grants.length === 0) {
      blockers.push(`${RULE.USAGE_INTERNAL_TO_DISTRIBUTE} 缺少对外分发法务授权`);
    } else {
      const uncovered = uncoveredRefPaths(dep);
      if (uncovered.length > 0) {
        blockers.push(
          `${RULE.GRANT_PATH_GAP} 授权未覆盖引用路径：${uncovered.join('、')}`,
        );
      }
    }
  }
  return blockers;
}

// ---- 候选审核与替换 ----
export function proposeCandidate(
  dep: Dep,
  candidate: Omit<DepSnapshot, never> & { proposedAt?: string },
): Dep {
  const snap: DepSnapshot = {
    version: candidate.version,
    license: candidate.license,
    copyright: candidate.copyright,
    source: candidate.source,
    usage: candidate.usage,
  };
  const diff = diffCandidate(dep.current, snap);
  return {
    ...dep,
    candidate: { ...snap, proposedAt: candidate.proposedAt ?? now() },
    review: {
      version: snap.version,
      verdict: diff.needsReview ? 'pending' : 'approved',
      changed: diff.changes,
    },
  };
}

export function reviewCandidate(
  dep: Dep,
  verdict: 'approved' | 'rejected',
  opts: { authorizer?: string; reason?: string } = {},
): Dep {
  if (!dep.candidate || !dep.review) return dep;
  if (verdict === 'approved') {
    const blockers = gplDistributeBlocked(
      dep.current,
      dep.candidate,
      dep,
    );
    if (blockers.length > 0) {
      return {
        ...dep,
        review: {
          ...dep.review,
          verdict: 'rejected',
          reason: blockers.join('；'),
          reviewedAt: now(),
          authorizer: opts.authorizer,
        },
      };
    }
  }
  return {
    ...dep,
    review: {
      ...dep.review,
      verdict,
      reason: opts.reason ?? dep.review.reason,
      authorizer: opts.authorizer ?? dep.review.authorizer,
      reviewedAt: now(),
    },
  };
}

/** 仅已审核通过的候选可替换当前版本；替换后候选清空，旧版本进入已审核版本链 */
export function promoteCandidate(dep: Dep): Dep {
  if (!dep.candidate || dep.review?.verdict !== 'approved') return dep;
  const approved: ApprovedVersion = { ...dep.current, approvedAt: now() };
  return {
    ...dep,
    current: {
      version: dep.candidate.version,
      license: dep.candidate.license,
      copyright: dep.candidate.copyright,
      source: dep.candidate.source,
      usage: dep.candidate.usage,
    },
    candidate: null,
    review: null,
    approvedVersions: [...dep.approvedVersions, approved],
  };
}

/** 撤回候选：仅恢复到最近一次已审核版本（当前版本不变，放弃未生效候选） */
export function withdrawCandidate(dep: Dep): Dep {
  if (!dep.candidate) return dep;
  return { ...dep, candidate: null, review: null };
}

/** 批次撤回后恢复依赖：只恢复最近一份已审核版本为当前版本 */
export function rollbackToLastApproved(dep: Dep): Dep {
  const last = dep.approvedVersions[dep.approvedVersions.length - 1];
  if (!last) return dep;
  return {
    ...dep,
    current: {
      version: last.version,
      license: last.license,
      copyright: last.copyright,
      source: last.source,
      usage: last.usage,
    },
    candidate: null,
    review: null,
    approvedVersions: dep.approvedVersions.slice(0, -1),
  };
}

// ---- 通知批次：冻结、撤回、补录 ----
let batchCounter = 0;
export function nextBatchId(seq: number): string {
  batchCounter += 1;
  return `B-${seq}-${batchCounter}`;
}

export function changeSummary(changes: ChangeKind[]): string {
  const map: Record<ChangeKind, string> = {
    version: '版本',
    license: '许可证',
    copyright: '版权声明',
    source: '来源',
    usage: '使用范围',
  };
  return changes.map((c) => map[c]).join('、') || '版本';
}

export interface BatchSelection {
  dep: Dep;
  item: NoticeBatchItem;
}

/**
 * 批次候选条目：
 * - 有候选（已审核通过待替换 / 待复核）→ 通知候选版本；
 * - 无候选但存在已审核版本链 → 通知最近一次已审核替换的当前版本。
 * 已出现在未撤回 / 未被补录取代批次中的条目不重复通知。
 */
export function selectBatchItems(
  deps: Dep[],
  batches: NoticeBatch[],
): BatchSelection[] {
  const notified = new Set(
    batches
      .filter((b) => b.status === 'frozen')
      .flatMap((b) => b.items.map((i) => `${i.depId}@${i.version}`)),
  );
  const out: BatchSelection[] = [];
  deps.forEach((d) => {
    let item: NoticeBatchItem | null = null;
    if (d.candidate) {
      item = {
        depId: d.id,
        name: d.name,
        version: d.candidate.version,
        license: d.candidate.license,
        changeSummary: d.review ? changeSummary(d.review.changed) : '版本',
      };
    } else if (d.approvedVersions.length > 0) {
      item = {
        depId: d.id,
        name: d.name,
        version: d.current.version,
        license: d.current.license,
        changeSummary: '版本',
      };
    }
    if (item && !notified.has(`${item.depId}@${item.version}`)) {
      out.push({ dep: d, item });
    }
  });
  return out;
}

export function freezeBatch(
  deps: Dep[],
  seq: number,
  batches: NoticeBatch[] = [],
): { batch: NoticeBatch; seq: number } | null {
  const items = selectBatchItems(deps, batches).map((s) => s.item);
  if (items.length === 0) return null;
  const nextSeq = seq + 1;
  return {
    seq: nextSeq,
    batch: {
      id: nextBatchId(nextSeq),
      seq: nextSeq,
      parentId: null,
      supplementReason: null,
      status: 'frozen',
      frozenAt: now(),
      items,
    },
  };
}

/** 撤回批次：批次标记撤回，关联依赖恢复到最近已审核版本 */
export function withdrawBatch(
  deps: Dep[],
  batch: NoticeBatch,
): { deps: Dep[]; batch: NoticeBatch } {
  const ids = new Set(batch.items.map((i) => i.depId));
  return {
    batch: { ...batch, status: 'withdrawn' },
    deps: deps.map((d) => (ids.has(d.id) ? rollbackToLastApproved(d) : d)),
  };
}

/**
 * 补录：已冻结批次不修改；另建一个指向原批次的新版本，必须填写原因。
 */
export function supplementBatch(
  parent: NoticeBatch,
  extraItems: NoticeBatchItem[],
  reason: string,
): NoticeBatch | null {
  if (!reason.trim() || extraItems.length === 0) return null;
  const nextSeq = parent.seq + 1;
  return {
    id: nextBatchId(nextSeq),
    seq: nextSeq,
    parentId: parent.id,
    supplementReason: reason.trim(),
    status: 'frozen',
    frozenAt: now(),
    // 补录版本包含原批次内容（保持快照完整）并追加补录项
    items: [...parent.items, ...extraItems],
  };
}

// ---- 刷新（重新扫描）：对齐并检出冲突 ----
export interface ObservedDep {
  name: string;
  version: string;
  license: string;
  copyright: string;
  source: string;
  usage: UsageKind;
  refs: string[];
}

export interface ReconcileResult {
  deps: Dep[];
  conflicts: Conflict[];
}

let conflictCounter = 0;
const conflictId = () => `C-${++conflictCounter}`;

/**
 * 以扫描观测结果为唯一事实来源，对齐依赖 / 引用路径 / 授权 / 批次与当前版本。
 * 未审核候选不会替换当前版本；观测与当前版本不一致即列入冲突。
 */
export function reconcile(
  prev: Dep[],
  batches: NoticeBatch[],
  observed: ObservedDep[],
): ReconcileResult {
  const conflicts: Conflict[] = [];
  const byName = new Map(prev.map((d) => [d.name, d]));

  const deps = observed.map((o): Dep => {
    const existing = byName.get(o.name);
    // 引用路径按观测去重重建，保留历史授权引用
    const refMap = new Map<string, number>();
    o.refs.forEach((p) => refMap.set(p, (refMap.get(p) ?? 0) + 1));
    const refs = [...refMap.entries()].map(([path, count]) => ({ path, count }));

    if (!existing) {
      const seed: DepSnapshot = {
        version: o.version,
        license: o.license,
        copyright: o.copyright,
        source: o.source,
        usage: o.usage,
      };
      return {
        id: Date.now() + Math.floor(Math.random() * 100000),
        name: o.name,
        current: seed,
        candidate: null,
        review: null,
        refs,
        grants: [],
        approvedVersions: [],
      };
    }

    let dep: Dep = { ...existing, refs };
    const cur = existing.current;

    // 已有候选：未审核不得替换；观测若继续指向候选版本则登记陈旧候选冲突
    if (existing.candidate && existing.review?.verdict !== 'approved') {
      conflicts.push({
        id: conflictId(),
        depId: existing.id,
        depName: existing.name,
        rule: RULE.CANDIDATE_UNAPPROVED,
        title: '未审核候选版本',
        detail: `候选 ${existing.candidate.version} 尚未审核通过，当前版本保持为 ${cur.version}`,
        oldLicense: cur.license,
        newLicense: existing.candidate.license,
        refPaths: refs.map((r) => r.path),
      });
    }

    // 观测相对当前版本的差异 → 冲突（复核项）
    const diff = diffCandidate(cur, {
      version: o.version,
      license: o.license,
      copyright: o.copyright,
      source: o.source,
      usage: o.usage,
    });
    if (diff.needsReview) {
      const primary = diff.changes.includes('license')
        ? {
            rule: RULE.LICENSE_CHANGE,
            title: '许可证发生变化，进入复核',
          }
        : diff.changes.includes('copyright')
          ? { rule: RULE.COPYRIGHT_CHANGE, title: '版权声明发生变化，进入复核' }
          : diff.changes.includes('source')
            ? { rule: RULE.SOURCE_CHANGE, title: '来源发生变化，进入复核' }
            : {
                rule: RULE.USAGE_INTERNAL_TO_DISTRIBUTE,
                title: 'GPL 系由内部使用升级为对外分发',
              };
      conflicts.push({
        id: conflictId(),
        depId: existing.id,
        depName: existing.name,
        rule: primary.rule,
        title: primary.title,
        detail: diff.reasons.join('；'),
        oldLicense: cur.license,
        newLicense: o.license,
        refPaths: refs.map((r) => r.path),
      });

      // 观测到的新版本登记为待审候选（不触碰当前版本）
      if (o.version !== cur.version && !existing.candidate) {
        dep = proposeCandidate(dep, {
          version: o.version,
          license: o.license,
          copyright: o.copyright,
          source: o.source,
          usage: o.usage,
        });
      }
    }

    // GPL 对外分发授权覆盖检查（对当前版本同样持续有效）
    if (isGplFamily(cur.license) && o.usage === 'external') {
      const checkDep = { ...dep, refs };
      const uncovered = uncoveredRefPaths(checkDep);
      if (activeGrants(checkDep).length === 0) {
        conflicts.push({
          id: conflictId(),
          depId: existing.id,
          depName: existing.name,
          rule: RULE.USAGE_INTERNAL_TO_DISTRIBUTE,
          title: 'GPL 对外分发缺少法务授权',
          detail: '对外分发须绑定覆盖全部引用路径的法务授权',
          oldLicense: cur.license,
          newLicense: o.license,
          refPaths: refs.map((r) => r.path),
        });
      } else if (uncovered.length > 0) {
        conflicts.push({
          id: conflictId(),
          depId: existing.id,
          depName: existing.name,
          rule: RULE.GRANT_PATH_GAP,
          title: '法务授权未覆盖全部引用路径',
          detail: `未覆盖：${uncovered.join('、')}`,
          oldLicense: cur.license,
          newLicense: cur.license,
          refPaths: uncovered,
        });
      }
    }

    return dep;
  });

  // 冻结批次与刷新后事实不一致 → 冲突
  const depById = new Map(deps.map((d) => [d.id, d]));
  batches
    .filter((b) => b.status === 'frozen')
    .forEach((b) => {
      b.items.forEach((item) => {
        const d = depById.get(item.depId);
        if (!d) return;
        if (
          d.current.version !== item.version ||
          d.current.license !== item.license
        ) {
          conflicts.push({
            id: conflictId(),
            depId: d.id,
            depName: d.name,
            rule: RULE.BATCH_STALE,
            title: `冻结批次 ${b.id} 与当前版本不一致`,
            detail: `批次记录 ${item.version}/${item.license}，当前版本 ${d.current.version}/${d.current.license}`,
            oldLicense: item.license,
            newLicense: d.current.license,
            refPaths: d.refs.map((r) => r.path),
          });
        }
      });
    });

  return { deps, conflicts };
}
