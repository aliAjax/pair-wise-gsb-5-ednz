// 界面层：状态装配 hook。把数据层与规则层接到 React，不写判定规则。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { initialState, STORAGE_KEY, scanFixture } from './data';
import {
  addRef,
  freezeBatch,
  gplDistributeBlocked,
  proposeCandidate,
  reconcile,
  removeRef,
  reviewCandidate,
  promoteCandidate,
  supplementBatch,
  withdrawBatch,
  withdrawCandidate,
  type CandidateDiff,
  diffCandidate,
} from './rules';
import type {
  ComplianceState,
  Conflict,
  Dep,
  LegalGrant,
  NoticeBatch,
  NoticeBatchItem,
  UsageKind,
} from './types';

function load(): ComplianceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ComplianceState;
  } catch {
    /* 损坏数据回退初始状态 */
  }
  return initialState();
}

export interface PendingCandidateInput {
  version: string;
  license: string;
  copyright: string;
  source: string;
  usage: UsageKind;
}

export function useCompliance() {
  const [state, setState] = useState<ComplianceState>(load);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const patchDep = useCallback((id: number, fn: (d: Dep) => Dep) => {
    setState((s) => ({ ...s, deps: s.deps.map((d) => (d.id === id ? fn(d) : d)) }));
  }, []);

  const diffs = useMemo(() => {
    const m = new Map<number, CandidateDiff>();
    state.deps.forEach((d) => {
      if (d.candidate) m.set(d.id, diffCandidate(d.current, d.candidate));
    });
    return m;
  }, [state.deps]);

  // 候选与审核
  const propose = useCallback(
    (id: number, input: PendingCandidateInput) =>
      patchDep(id, (d) => proposeCandidate(d, input)),
    [patchDep],
  );

  const review = useCallback(
    (id: number, verdict: 'approved' | 'rejected', authorizer?: string, reason?: string) =>
      patchDep(id, (d) => reviewCandidate(d, verdict, { authorizer, reason })),
    [patchDep],
  );

  const promote = useCallback(
    (id: number) => patchDep(id, promoteCandidate),
    [patchDep],
  );

  const withdraw = useCallback(
    (id: number) => patchDep(id, withdrawCandidate),
    [patchDep],
  );

  // 引用路径
  const addReference = useCallback(
    (id: number, path: string) => patchDep(id, (d) => addRef(d, path)),
    [patchDep],
  );
  const removeReference = useCallback(
    (id: number, path: string) => patchDep(id, (d) => removeRef(d, path)),
    [patchDep],
  );

  // 法务授权
  const addGrant = useCallback(
    (id: number, grant: Omit<LegalGrant, 'id' | 'active'>) =>
      patchDep(id, (d) => ({
        ...d,
        grants: [
          ...d.grants,
          { ...grant, id: `G-${d.id}-${d.grants.length + 1}`, active: true },
        ],
      })),
    [patchDep],
  );

  const gplBlockers = useCallback(
    (dep: Dep): string[] =>
      dep.candidate
        ? gplDistributeBlocked(dep.current, dep.candidate, dep)
        : [],
    [],
  );

  // 通知批次
  const freeze = useCallback((): NoticeBatch | null => {
    let created: NoticeBatch | null = null;
    setState((s) => {
      const r = freezeBatch(s.deps, s.seq, s.batches);
      if (!r) return s;
      created = r.batch;
      return { ...s, seq: r.seq, batches: [...s.batches, r.batch] };
    });
    return created;
  }, []);

  const withdrawOneBatch = useCallback((batchId: string) => {
    setState((s) => {
      const batch = s.batches.find((b) => b.id === batchId);
      if (!batch || batch.status !== 'frozen') return s;
      const r = withdrawBatch(s.deps, batch);
      return {
        ...s,
        deps: r.deps,
        batches: s.batches.map((b) => (b.id === batchId ? r.batch : b)),
      };
    });
  }, []);

  const supplement = useCallback(
    (parentId: string, extra: NoticeBatchItem[], reason: string) => {
      setState((s) => {
        const parent = s.batches.find((b) => b.id === parentId);
        if (!parent) return s;
        const created = supplementBatch(parent, extra, reason);
        if (!created) return s;
        return { ...s, batches: [...s.batches, created] };
      });
    },
    [],
  );

  // 刷新（重新扫描）：对齐依赖 / 路径 / 授权 / 批次与当前版本，列出冲突
  const rescan = useCallback(() => {
    setState((s) => {
      const r = reconcile(s.deps, s.batches, scanFixture);
      setConflicts(r.conflicts);
      setLastScannedAt(new Date().toISOString());
      return { ...s, deps: r.deps };
    });
  }, []);

  const reset = useCallback(() => {
    setState(initialState());
    setConflicts([]);
    setLastScannedAt(null);
  }, []);

  return {
    state,
    conflicts,
    lastScannedAt,
    diffs,
    propose,
    review,
    promote,
    withdraw,
    addReference,
    removeReference,
    addGrant,
    gplBlockers,
    freeze,
    withdrawOneBatch,
    supplement,
    rescan,
    reset,
  };
}
