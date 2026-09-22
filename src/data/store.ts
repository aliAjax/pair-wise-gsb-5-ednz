// 数据层：存储与动作
// 只管状态的读写、持久化与历史留痕；是否合规由 rules 层判定。

import type {
  AppState,
  Authorization,
  Batch,
  Candidate,
  Dep,
  Distribution,
  PathRef,
  VersionRecord,
} from '../domain/types';
import {
  currentRecord,
  deriveNotifications,
  evaluateCandidate,
  isGplFamily,
  pathKey,
  refreshCheck,
  snapshotFromNotifications,
  uid,
  validateBackfill,
  withdrawTarget,
} from '../rules/compliance';

const STORAGE_KEY = 'license-lens-v2';

/* ---------------- 种子数据 ---------------- */

const now = Date.now();
let idc = 0;
const nid = () => ++idc;

const ref = (path: string, scope: Distribution, note?: string): PathRef => ({
  id: uid('ref'),
  path,
  scope,
  note,
  addedAt: now,
});

const ver = (
  version: string,
  license: string,
  copyright: string,
  source: string,
  extra: Partial<VersionRecord> = {},
): VersionRecord => ({
  version,
  license,
  copyright,
  source,
  reviewed: extra.reviewed ?? true,
  reviewedAt: extra.reviewedAt ?? now,
  reviewedBy: extra.reviewedBy ?? 'Zen Li',
  note: extra.note,
  backfill: extra.backfill,
  backfillReason: extra.backfillReason,
  withdrawnAt: extra.withdrawnAt,
});

const cand = (c: Omit<Candidate, 'detectedAt' | 'reviewed'>): Candidate => ({
  ...c,
  detectedAt: now,
  reviewed: false,
});

const seedState = (): AppState => {
  const reactPath = ref('src/ui/Dashboard.tsx', 'external', '生产包直接打包');
  const lodashPath = ref('src/utils/format.ts', 'external');
  const hlPath = ref('src/components/CodeBlock.tsx', 'external', '再发布需保留声明');
  const legacyInternal = ref('tools/build/legacy-loader.js', 'internal', '仅构建期内部使用');
  const legacyExternal = ref('dist/vendor/legacy-parser.min.js', 'external', '随安装包对外分发');
  const stamperPath = ref('src/report/exportPdf.ts', 'external', 'SaaS 对外提供能力');

  const deps: Dep[] = [
    {
      id: nid(),
      name: 'react',
      currentVersion: '18.3.1',
      versions: {
        '18.3.1': ver('18.3.1', 'MIT', 'Copyright (c) Meta Platforms, Inc. and affiliates.', 'npm'),
      },
      history: ['18.3.1'],
      candidates: [
        cand({
          version: '19.0.0',
          license: 'MIT',
          copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
          source: 'npm',
          note: '主版本升级',
        }),
      ],
      paths: [reactPath],
      createdAt: now,
    },
    {
      id: nid(),
      name: 'lodash',
      currentVersion: '4.17.21',
      versions: {
        '4.17.21': ver('4.17.21', 'MIT', 'Copyright JS Foundation and other contributors', 'npm'),
      },
      history: ['4.17.21'],
      candidates: [
        cand({
          version: '4.18.0',
          license: 'Apache-2.0',
          copyright: 'Copyright JS Foundation and other contributors',
          source: 'npm',
          note: '许可证变更，需复核',
        }),
      ],
      paths: [lodashPath],
      createdAt: now,
    },
    {
      id: nid(),
      name: 'chart.js',
      currentVersion: '4.4.4',
      versions: {
        '4.4.4': ver('4.4.4', 'MIT', 'Copyright (c) 2014-2024 Chart.js Contributors', 'npm'),
      },
      history: ['4.4.4'],
      candidates: [],
      paths: [ref('src/dash/charts.tsx', 'external')],
      createdAt: now,
    },
    {
      id: nid(),
      name: 'highlight.js',
      currentVersion: '11.10.0',
      versions: {
        '11.10.0': ver('11.10.0', 'BSD-3-Clause', 'Copyright (c) 2006, Ivan Sagalaev', 'npm', {
          note: '再发布需保留版权声明',
        }),
      },
      history: ['11.10.0'],
      candidates: [
        cand({
          version: '11.11.0',
          license: 'BSD-3-Clause',
          copyright: 'Copyright (c) 2006-2026, Ivan Sagalaev and contributors',
          source: 'npm',
          note: '版权声明署名发生变化',
        }),
      ],
      paths: [hlPath],
      createdAt: now,
    },
    {
      id: nid(),
      name: 'legacy-parser',
      currentVersion: '2.1.0',
      versions: {
        '2.1.0': ver('2.1.0', 'GPL-3.0', 'Copyright (c) 2014 Acme Legacy Tools', '手动', {
          reviewedBy: '法务-王敏',
          note: '内部使用阶段已登记；对外分发路径尚未授权',
        }),
      },
      history: ['2.1.0'],
      candidates: [
        cand({
          version: '3.0.0',
          license: 'GPL-3.0',
          copyright: 'Copyright (c) 2014-2026 Acme Legacy Tools',
          source: '手动',
        }),
      ],
      paths: [legacyInternal, legacyExternal],
      createdAt: now,
    },
    {
      id: nid(),
      name: 'pdf-stamper',
      currentVersion: '1.4.0',
      versions: {
        '1.4.0': ver('1.4.0', 'AGPL-3.0', 'Copyright (c) 2020 Stamper OSS Authors', 'npm', {
          reviewedBy: '法务-王敏',
        }),
      },
      history: ['1.4.0'],
      candidates: [],
      paths: [stamperPath],
      createdAt: now,
    },
  ];

  const authorizations: Authorization[] = [
    {
      id: uid('aut'),
      depId: deps[5].id,
      version: '1.4.0',
      coveredPathIds: [stamperPath.id],
      approver: '法务-王敏',
      approvedAt: now,
      note: 'AGPL 对外网络服务已签署法务授权（工单 LEG-2026-018）',
    },
  ];

  const state: AppState = {
    deps,
    authorizations,
    queue: [],
    batches: [],
    batchSeq: 0,
    conflicts: [],
    lastRefreshedAt: 0,
  };
  state.queue = deriveNotifications(state);
  return state;
};

/* ---------------- 持久化 ---------------- */

const load = (): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.deps)) return parsed;
    }
  } catch {
    /* 损坏数据回落到种子 */
  }
  return seedState();
};

/* ---------------- Store ---------------- */

class LicenseStore {
  private state: AppState = load();
  private listeners = new Set<() => void>();

  getState = (): AppState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private commit(next: AppState) {
    this.state = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.listeners.forEach((fn) => fn());
  }

  /** 活清单重算：已解决自动消失；已冻结批次中同身份条目不重复出现 */
  private reconcile(s: AppState): AppState {
    const frozen = s.batches.flatMap((b) => b.items);
    const live = deriveNotifications(s).filter((n) => {
      const path = n.path ?? '';
      const version = n.version ?? '';
      // 多路径合并产生的通知（path 为路径列表）按「任一路径命中」匹配冻结项
      const paths = path.split('、');
      return !frozen.some(
        (i) =>
          i.depId === n.depId &&
          i.kind === n.kind &&
          (i.version || '') === version &&
          (i.path === path || (!!path && paths.includes(i.path))),
      );
    });
    return { ...s, queue: live };
  }

  private mutate(fn: (s: AppState) => AppState) {
    this.commit(this.reconcile(fn(this.state)));
  }

  /* ---- 依赖 ---- */

  addDep(input: { name: string; license: string; copyright: string; source: string; path: string; scope: Distribution }) {
    this.mutate((s) => {
      const id = Date.now();
      const version0 = '1.0.0';
      const dep: Dep = {
        id,
        name: input.name.trim(),
        currentVersion: version0,
        versions: {
          [version0]: ver(version0, input.license, input.copyright, input.source),
        },
        history: [version0],
        candidates: [],
        paths: input.path.trim() ? [ref(input.path, input.scope)] : [],
        createdAt: Date.now(),
      };
      return { ...s, deps: [...s.deps, dep] };
    });
  }

  /* ---- 候选版本（R1/R2） ---- */

  addCandidate(depId: number, c: Omit<Candidate, 'detectedAt' | 'reviewed'>) {
    this.mutate((s) => ({
      ...s,
      deps: s.deps.map((d) =>
        d.id === depId && !d.candidates.some((x) => x.version === c.version)
          ? { ...d, candidates: [...d.candidates, cand(c)] }
          : d,
      ),
    }));
  }

  /** 审核候选：复核元数据差异后标记，审核后才可替换当前版本 */
  reviewCandidate(depId: number, version: string, reviewer = 'Zen Li') {
    this.mutate((s) => ({
      ...s,
      deps: s.deps.map((d) =>
        d.id === depId
          ? {
              ...d,
              candidates: d.candidates.map((c) =>
                c.version === version
                  ? { ...c, reviewed: true, reviewedAt: Date.now(), reviewedBy: reviewer }
                  : c,
              ),
            }
          : d,
      ),
    }));
  }

  /** 应用候选为当前版本：未审核一律拒绝（R1），返回是否成功 */
  applyCandidate(depId: number, version: string): { ok: boolean; reason?: string } {
    const dep = this.state.deps.find((d) => d.id === depId);
    const candidate = dep?.candidates.find((c) => c.version === version);
    if (!dep || !candidate) return { ok: false, reason: '候选版本不存在' };
    const ev = evaluateCandidate(dep, candidate);
    if (ev.blocked) return { ok: false, reason: '未审核候选版本不得替换当前版本（R1）' };

    this.mutate((s) => ({
      ...s,
      deps: s.deps.map((d) => {
        if (d.id !== depId) return d;
        const c = d.candidates.find((x) => x.version === version)!;
        const record: VersionRecord = {
          version: c.version,
          license: c.license,
          copyright: c.copyright,
          source: c.source,
          reviewed: true,
          reviewedAt: c.reviewedAt,
          reviewedBy: c.reviewedBy,
          note: c.note,
        };
        return {
          ...d,
          currentVersion: c.version,
          versions: { ...d.versions, [c.version]: record },
          history: d.history.includes(c.version) ? d.history : [...d.history, c.version],
          candidates: d.candidates.filter((x) => x.version !== version),
        };
      }),
    }));
    return { ok: true };
  }

  /** 撤回当前版本：只恢复最近的已审核版本（R5） */
  withdrawCurrent(depId: number): { ok: boolean; reason?: string } {
    const dep = this.state.deps.find((d) => d.id === depId);
    if (!dep) return { ok: false, reason: '依赖不存在' };
    const target = withdrawTarget(dep);
    if (!target) return { ok: false, reason: '历史中没有可恢复的已审核版本（R5）' };

    this.mutate((s) => ({
      ...s,
      deps: s.deps.map((d) => {
        if (d.id !== depId) return d;
        const bad = d.versions[d.currentVersion];
        const versions = {
          ...d.versions,
          [d.currentVersion]: { ...bad, withdrawnAt: Date.now() },
        };
        const history = d.history.slice(0, -1);
        return { ...d, versions, history, currentVersion: target.version };
      }),
    }));
    return { ok: true };
  }

  /** 补录：另建一条带原因的版本记录，不覆盖既有记录、不改变当前版本（R6） */
  backfill(
    depId: number,
    input: { version: string; license: string; copyright: string; source: string; reason: string },
  ): { ok: boolean; reason?: string } {
    const err = validateBackfill(input.version, input.reason);
    if (err) return { ok: false, reason: err };
    const dep = this.state.deps.find((d) => d.id === depId);
    if (dep?.versions[input.version.trim()])
      return { ok: false, reason: '该版本记录已存在，补录不得覆盖既有记录（R6）' };

    this.mutate((s) => ({
      ...s,
      deps: s.deps.map((d) =>
        d.id === depId
          ? {
              ...d,
              versions: {
                ...d.versions,
                [input.version.trim()]: {
                  ...ver(input.version.trim(), input.license, input.copyright, input.source, {
                    reviewedBy: '补录 / Zen Li',
                  }),
                  backfill: true,
                  backfillReason: input.reason.trim(),
                },
              },
            }
          : d,
      ),
    }));
    return { ok: true };
  }

  /* ---- 引用路径（R4） ---- */

  addPath(depId: number, path: string, scope: Distribution, note?: string) {
    if (!path.trim()) return;
    this.mutate((s) => ({
      ...s,
      deps: s.deps.map((d) =>
        d.id === depId ? { ...d, paths: [...d.paths, ref(path.trim(), scope, note)] } : d,
      ),
    }));
  }

  /** 移除一条引用（软删除）；同路径仍有其他引用时义务保留，最后一条移除后才收回（R4） */
  removePath(depId: number, refId: string) {
    this.mutate((s) => ({
      ...s,
      deps: s.deps.map((d) =>
        d.id === depId
          ? {
              ...d,
              paths: d.paths.map((p) => (p.id === refId ? { ...p, removedAt: Date.now() } : p)),
            }
          : d,
      ),
    }));
  }

  /** 重新登记已移除的引用（同键），产生一条新引用记录 */
  reinstatePath(depId: number, refId: string) {
    this.mutate((s) => ({
      ...s,
      deps: s.deps.map((d) => {
        if (d.id !== depId) return d;
        const old = d.paths.find((p) => p.id === refId);
        if (!old || !old.removedAt) return d;
        return { ...d, paths: [...d.paths, ref(old.path, old.scope, old.note)] };
      }),
    }));
  }

  /** 同一路径还剩几条有效引用（R4 界面提示用） */
  activeRefCount(dep: Dep, path: string): number {
    const key = pathKey(path);
    return dep.paths.filter((p) => !p.removedAt && pathKey(p.path) === key).length;
  }

  /* ---- 法务授权（R3） ---- */

  addAuthorization(input: Omit<Authorization, 'id' | 'approvedAt'>) {
    this.mutate((s) => ({
      ...s,
      authorizations: [
        ...s.authorizations,
        { ...input, id: uid('aut'), approvedAt: Date.now() },
      ],
    }));
  }

  revokeAuthorization(id: string) {
    this.mutate((s) => ({
      ...s,
      authorizations: s.authorizations.map((a) =>
        a.id === id ? { ...a, revoked: true, revokedAt: Date.now() } : a,
      ),
    }));
  }

  /* ---- 通知批次：冻结（不可变） ---- */

  freezeBatch(note?: string): Batch {
    const s = this.state;
    const batch: Batch = {
      id: uid('bch'),
      number: s.batchSeq + 1,
      createdAt: Date.now(),
      frozen: true,
      items: snapshotFromNotifications(s, s.queue),
      note,
    };
    this.commit({
      ...s,
      batches: [...s.batches, batch],
      batchSeq: batch.number,
      queue: [], // 冻结后活清单清空；后续变化产生新条目
    });
    return batch;
  }

  /* ---- 刷新：一致性校验（R7） ---- */

  refresh() {
    this.mutate((s) => ({
      ...s,
      conflicts: refreshCheck(s).conflicts,
      lastRefreshedAt: Date.now(),
    }));
  }

  /* ---- 工具 ---- */

  resetAll() {
    const fresh = seedState();
    fresh.lastRefreshedAt = 0;
    this.commit(fresh);
  }

  isGpl(dep: Dep): boolean {
    return isGplFamily(currentRecord(dep)?.license ?? '');
  }
}

export const store = new LicenseStore();
