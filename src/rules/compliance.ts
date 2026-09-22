// 规则层：合规判定
// 纯函数，不依赖存储与界面；输入领域数据，输出判定结果。
//
// 规则清单（ruleCode 与界面冲突行对应）：
//  R1 unreviewed-candidate : 未审核候选版本不得替换当前版本
//  R2 metadata-changed     : 候选版本的许可证 / 版权声明 / 来源发生变化 → 复核
//  R3 gpl-external-auth    : GPL 系由内部使用升级为对外分发，须绑定覆盖引用路径的法务授权
//  R4 last-ref-removed     : 同一路径重复引用只保留一份义务；最后引用移除后才收回
//  R5 withdraw-reviewed    : 撤回只恢复最近的「已审核」版本
//  R6 backfill-reason      : 补录另建带原因版本
//  R7 refresh-consistency  : 刷新后依赖 / 路径 / 授权 / 批次与当前版本须一致

import type {
  AppState,
  Authorization,
  BatchSnapshotItem,
  Candidate,
  Conflict,
  Dep,
  DepRisk,
  Distribution,
  NotificationItem,
  NotificationKind,
  PathRef,
  VersionRecord,
} from '../domain/types';

let seq = 0;
export const uid = (p: string): string =>
  `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/* ---------------- 基础识别 ---------------- */

export const GPL_FAMILY = ['GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0'];

export const isGplFamily = (license: string): boolean =>
  GPL_FAMILY.some((g) => license.toUpperCase().includes(g.replace('-', '').replace('.', '')) ||
    license === g);

export const riskOf = (license: string, hasExternalGplIssue: boolean): DepRisk => {
  if (hasExternalGplIssue) return 'risk';
  if (isGplFamily(license)) return 'warn';
  if (license === 'MIT' || license === 'Apache-2.0' || license.startsWith('ISC')) return 'ok';
  return 'warn';
};

/* ---------------- 派生查询（不在数据层做判断） ---------------- */

export const activePaths = (dep: Dep): PathRef[] =>
  dep.paths.filter((p) => !p.removedAt);

/** 同一路径的引用去重：义务只保留一份（按规范化路径键） */
export const pathKey = (raw: string): string => raw.trim().replace(/\/+$/, '');

export const uniqueActivePathKeys = (dep: Dep): Set<string> =>
  new Set(activePaths(dep).map((p) => pathKey(p.path)));

export const currentRecord = (dep: Dep): VersionRecord => dep.versions[dep.currentVersion];

export const candidateFor = (dep: Dep, version?: string): Candidate | undefined =>
  dep.candidates.find((c) => c.version === (version ?? dep.candidates[dep.candidates.length - 1]?.version));

/** 该路径上的义务是否仍需保留：至少存在一条未移除引用 */
export const obligationAlive = (dep: Dep, key: string): boolean =>
  activePaths(dep).some((p) => pathKey(p.path) === key);

/* ---------------- 授权（R3） ---------------- */

export const activeAuthorizations = (state: AppState): Authorization[] =>
  state.authorizations.filter((a) => !a.revoked);

/**
 * 授权是否覆盖某条对外分发引用：
 * 依赖一致、版本为当前版本、路径在覆盖清单内、授权有效。
 */
export const authorizationCovers = (
  state: AppState,
  dep: Dep,
  ref: PathRef,
): Authorization | undefined =>
  activeAuthorizations(state).find(
    (a) =>
      a.depId === dep.id &&
      a.version === dep.currentVersion &&
      a.coveredPathIds.includes(ref.id),
  );

/** GPL 系、当前版本、对外分发，且没有覆盖该引用路径的有效授权 */
export const uncoveredExternalGplRefs = (state: AppState, dep: Dep): PathRef[] => {
  const rec = currentRecord(dep);
  if (!rec || !isGplFamily(rec.license)) return [];
  return activePaths(dep).filter(
    (p) => p.scope === 'external' && !authorizationCovers(state, dep, p),
  );
};

/* ---------------- R1/R2：候选版本评估 ---------------- */

export interface CandidateEval {
  candidate: Candidate;
  blocked: boolean; // R1：未审核 → 禁止替换
  changes: { field: string; from: string; to: string }[]; // R2 差异
  needsReview: boolean;
}

export const evaluateCandidate = (dep: Dep, candidate: Candidate): CandidateEval => {
  const cur = currentRecord(dep);
  const changes: CandidateEval['changes'] = [];
  if (!cur) return { candidate, blocked: !candidate.reviewed, changes, needsReview: false };
  if (candidate.license !== cur.license)
    changes.push({ field: '许可证', from: cur.license, to: candidate.license });
  if ((candidate.copyright || '').trim() !== (cur.copyright || '').trim())
    changes.push({ field: '版权声明', from: cur.copyright || '（无）', to: candidate.copyright || '（无）' });
  if (candidate.source !== cur.source)
    changes.push({ field: '来源', from: cur.source, to: candidate.source });
  const blocked = !candidate.reviewed; // R1
  const needsReview = changes.length > 0; // R2：变化即进入复核
  return { candidate, blocked, changes, needsReview };
};

/* ---------------- 活清单：通知生成 ---------------- */

const notify = (
  kind: NotificationKind,
  dep: Dep,
  title: string,
  detail: string,
  extra: Partial<NotificationItem> = {},
): NotificationItem => ({
  id: uid('ntf'),
  kind,
  depId: dep.id,
  depName: dep.name,
  title,
  detail,
  createdAt: Date.now(),
  ...extra,
});

/**
 * 根据当前状态派生活通知清单。同一路径重复引用只产出一份义务通知。
 */
export const deriveNotifications = (state: AppState): NotificationItem[] => {
  const out: NotificationItem[] = [];
  for (const dep of state.deps) {
    for (const c of dep.candidates) {
      const ev = evaluateCandidate(dep, c);
      if (ev.blocked)
        out.push(
          notify(
            'unapproved-candidate',
            dep,
            `候选版本 ${c.version} 未经审核`,
            `未审核候选版本不得替换当前版本 ${dep.currentVersion}（R1）。`,
            { version: c.version },
          ),
        );
      if (ev.needsReview && !c.reviewed)
        out.push(
          notify(
            'review-required',
            dep,
            `${dep.name} ${c.version} 元数据发生变化`,
            ev.changes.map((h) => `${h.field}：${h.from} → ${h.to}`).join('；') + '（R2，进入复核）。',
            { version: c.version },
          ),
        );
    }
    // R3：去重后的对外分发路径各检查一次
    for (const ref of uncoveredExternalGplRefs(state, dep)) {
      out.push(
        notify(
          'gpl-external',
          dep,
          `对外分发缺少法务授权：${ref.path}`,
          `${currentRecord(dep)?.license} 由内部使用升级为对外分发，须绑定覆盖引用路径 ${ref.path} 的法务授权（R3）。`,
          { pathId: ref.id, path: ref.path, version: dep.currentVersion },
        ),
      );
    }
  }
  return out;
};

/* ---------------- R7：刷新一致性校验 ---------------- */

export interface RefreshResult {
  conflicts: Conflict[];
}

const conflict = (
  dep: Dep,
  c: Omit<Conflict, 'id' | 'depId' | 'depName'>,
): Conflict => ({
  id: uid('cfl'),
  depId: dep.id,
  depName: dep.name,
  ...c,
});

/**
 * 刷新：以当前版本为准，核对依赖、路径、授权与已冻结批次。
 * 输出冲突行（依赖 / 旧新许可证 / 引用路径 / 命中规则）。
 */
export const refreshCheck = (state: AppState): RefreshResult => {
  const conflicts: Conflict[] = [];
  for (const dep of state.deps) {
    const cur = currentRecord(dep);
    if (!cur) {
      conflicts.push(
        conflict(dep, {
          oldLicense: '-',
          newLicense: '-',
          path: '-',
          ruleCode: 'R7',
          rule: '当前版本与版本记录不一致',
          severity: 'risk',
          detail: `当前版本 ${dep.currentVersion} 在版本记录中缺失，无法核对。`,
        }),
      );
      continue;
    }

    // R7a：存在指向当前版本但未审核、却已成为当前版本的记录（违反 R1 的历史结果）
    if (!cur.reviewed) {
      conflicts.push(
        conflict(dep, {
          oldLicense: '-',
          newLicense: cur.license,
          path: uniquePathList(dep),
          ruleCode: 'R1',
          rule: '未审核候选版本不得替换当前版本',
          severity: 'risk',
          detail: `${dep.name} 当前版本 ${dep.currentVersion} 未审核。`,
        }),
      );
    }

    // R7b：授权版本 / 覆盖路径与当前引用一致
    for (const a of activeAuthorizations(state).filter((x) => x.depId === dep.id)) {
      if (a.version !== dep.currentVersion) {
        conflicts.push(
          conflict(dep, {
            oldLicense: cur.license,
            newLicense: cur.license,
            path: coveredPathText(dep, a.coveredPathIds),
            ruleCode: 'R7',
            rule: '授权版本与当前版本不一致',
            severity: 'warn',
            detail: `授权绑定 ${a.version}，当前版本为 ${dep.currentVersion}，授权需重新核对。`,
          }),
        );
      }
      for (const pid of a.coveredPathIds) {
        const ref = dep.paths.find((p) => p.id === pid);
        if (!ref || ref.removedAt) {
          conflicts.push(
            conflict(dep, {
              oldLicense: cur.license,
              newLicense: cur.license,
              path: ref?.path ?? `（已删除引用 #${pid}）`,
              ruleCode: 'R7',
              rule: '授权覆盖路径与当前引用不一致',
              severity: 'warn',
              detail: '授权覆盖的引用路径已不存在；最后引用移除后相应义务应收回（R4）。',
            }),
          );
        }
      }
    }

    // R7c：GPL 对外分发授权覆盖（与活清单一致，冲突行形式落地）
    for (const ref of uncoveredExternalGplRefs(state, dep)) {
      conflicts.push(
        conflict(dep, {
          oldLicense: cur.license,
          newLicense: cur.license,
          path: ref.path,
          ruleCode: 'R3',
          rule: 'GPL 对外分发须绑定覆盖引用路径的法务授权',
          severity: 'risk',
          detail: `引用 ${ref.path} 为对外分发，当前版本 ${dep.currentVersion}（${cur.license}）缺少有效授权。`,
        }),
      );
    }

    // R7d：冻结批次记录的版本/许可证与当前不一致（批次快照本身不可改，只列冲突）
    for (const batch of state.batches) {
      for (const item of batch.items.filter((i) => i.depId === dep.id)) {
        if (item.version !== dep.currentVersion || item.license !== cur.license) {
          conflicts.push(
            conflict(dep, {
              oldLicense: item.license,
              newLicense: cur.license,
              path: item.path,
              ruleCode: 'R7',
              rule: `冻结批次 #${batch.number} 与当前版本不一致`,
              severity: 'warn',
              detail: `批次 #${batch.number} 冻结于 ${item.version}（${item.license}），当前为 ${dep.currentVersion}（${cur.license}）。批次快照不可修改，撤回只恢复最近已审核版本、补录另建带原因版本（R5/R6）。`,
            }),
          );
        }
      }
    }
  }
  return { conflicts };
};

const uniquePathList = (dep: Dep): string =>
  [...uniqueActivePathKeys(dep)].join('、') || '（无引用路径）';

const coveredPathText = (dep: Dep, ids: string[]): string => {
  const set = new Set(ids);
  const paths = dep.paths.filter((p) => set.has(p.id)).map((p) => p.path);
  return paths.join('、') || '（无匹配路径）';
};

/* ---------------- 批次冻结快照 ---------------- */

export const snapshotFromNotifications = (
  state: AppState,
  items: NotificationItem[],
): BatchSnapshotItem[] =>
  items.map((n) => {
    const dep = state.deps.find((d) => d.id === n.depId);
    const license =
      (n.version && dep?.versions[n.version]?.license) ||
      (dep && currentRecord(dep)?.license) ||
      '';
    return {
      depId: n.depId,
      depName: n.depName,
      version: n.version ?? dep?.currentVersion ?? '',
      license,
      path: n.path ?? uniquePathList(dep as Dep),
      kind: n.kind,
      title: n.title,
      detail: n.detail,
    };
  });

/* ---------------- R5：撤回目标选择 ---------------- */

export const withdrawTarget = (dep: Dep): VersionRecord | undefined => {
  // 沿历史栈向前找最近的「已审核且未撤回」版本
  for (let i = dep.history.length - 2; i >= 0; i--) {
    const rec = dep.versions[dep.history[i]];
    if (rec && rec.reviewed && !rec.withdrawnAt) return rec;
  }
  return undefined;
};

/* ---------------- R6：补录校验 ---------------- */

export const validateBackfill = (version: string, reason: string): string | null => {
  if (!version.trim()) return '补录版本号不能为空';
  if (!reason.trim()) return '补录必须填写原因（R6）';
  return null;
};

export type { Distribution };
