// 界面层：依赖升级合规差异审查视图
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  CopyPlus,
  FileWarning,
  GitBranch,
  History,
  Link2,
  Lock,
  RefreshCw,
  RotateCcw,
  Scale,
  Send,
  ShieldCheck,
  Snowflake,
  X,
} from 'lucide-react';
import {
  changeSummary,
  isGplFamily,
  selectBatchItems,
  uncoveredRefPaths,
} from '../compliance/rules';
import type {
  Conflict,
  Dep,
  LegalGrant,
  NoticeBatch,
  NoticeBatchItem,
  UsageKind,
} from '../compliance/types';
import type { PendingCandidateInput, useCompliance } from '../compliance/useCompliance';

type Store = ReturnType<typeof useCompliance>;

const licenseColor: Record<string, string> = {
  MIT: '#35b995',
  'BSD-3-Clause': '#6d9ee8',
  'GPL-3.0': '#ec8c75',
  'Apache-2.0': '#b18ee4',
};

const usageLabel = (u: UsageKind) => (u === 'external' ? '对外分发' : '内部使用');

function VerdictPill({ dep }: { dep: Dep }) {
  if (!dep.candidate) return <span className="pill muted">无候选</span>;
  const v = dep.review?.verdict ?? 'pending';
  if (v === 'approved')
    return (
      <span className="pill ok">
        <Check size={11} /> 已审核
      </span>
    );
  if (v === 'rejected')
    return (
      <span className="pill risk">
        <Ban size={11} /> 已驳回
      </span>
    );
  return (
    <span className="pill warn">
      <AlertTriangle size={11} /> 待复核
    </span>
  );
}

function FieldDiff({
  label,
  oldV,
  newV,
  changed,
}: {
  label: string;
  oldV: string;
  newV: string;
  changed: boolean;
}) {
  return (
    <div className={changed ? 'diff-row hit' : 'diff-row'}>
      <label>{label}</label>
      <div className="diff-vals">
        <span className="old">{oldV || '—'}</span>
        {changed && <ArrowRight size={12} className="diff-arrow" />}
        <span className="new">{newV || '—'}</span>
      </div>
      {changed && <i className="diff-badge">变化</i>}
    </div>
  );
}

function CandidateForm({
  dep,
  onPropose,
}: {
  dep: Dep;
  onPropose: (id: number, input: PendingCandidateInput) => void;
}) {
  const [version, setVersion] = useState('');
  const [license, setLicense] = useState(dep.current.license);
  const [copyright, setCopyright] = useState(dep.current.copyright);
  const [source, setSource] = useState(dep.current.source);
  const [usage, setUsage] = useState<UsageKind>(dep.current.usage);
  const submit = () => {
    if (!version.trim() || version.trim() === dep.current.version) return;
    onPropose(dep.id, {
      version: version.trim(),
      license,
      copyright,
      source,
      usage,
    });
  };
  return (
    <div className="propose-box">
      <div className="box-title">
        <GitBranch size={14} /> 登记候选版本
      </div>
      <div className="propose-grid">
        <label>
          候选版本
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="如 4.5.0"
          />
        </label>
        <label>
          许可证
          <select value={license} onChange={(e) => setLicense(e.target.value)}>
            <option>MIT</option>
            <option>BSD-3-Clause</option>
            <option>Apache-2.0</option>
            <option>GPL-3.0</option>
            <option>LGPL-3.0</option>
          </select>
        </label>
        <label>
          来源
          <input value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label>
          使用范围
          <select
            value={usage}
            onChange={(e) => setUsage(e.target.value as UsageKind)}
          >
            <option value="external">对外分发</option>
            <option value="internal">内部使用</option>
          </select>
        </label>
        <label className="span2">
          版权声明
          <input
            value={copyright}
            onChange={(e) => setCopyright(e.target.value)}
          />
        </label>
      </div>
      <button className="primary sm" onClick={submit} disabled={!version.trim()}>
        提交候选并比对差异
      </button>
      <p className="hint">许可证、版权声明或来源变化时自动进入复核；未审核候选不会替换当前版本。</p>
    </div>
  );
}

function RefsPanel({ dep, store }: { dep: Dep; store: Store }) {
  const [path, setPath] = useState('');
  return (
    <div className="subpanel">
      <div className="box-title">
        <Link2 size={14} /> 引用路径
        <span className="title-note">同一路径重复引用只保留一份义务</span>
      </div>
      {dep.refs.length === 0 && <p className="hint">无引用，相关义务已收回。</p>}
      <ul className="ref-list">
        {dep.refs.map((r) => (
          <li key={r.path}>
            <code>{r.path}</code>
            {r.count > 1 && <span className="ref-count">×{r.count}</span>}
            <button
              className="icon-btn"
              title="移除一次引用（计数归零后收回义务）"
              onClick={() => store.removeReference(dep.id, r.path)}
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="inline-add">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="新增引用路径，如 src/app/x.ts"
        />
        <button
          onClick={() => {
            if (path.trim()) {
              store.addReference(dep.id, path);
              setPath('');
            }
          }}
        >
          添加
        </button>
      </div>
    </div>
  );
}

function GrantsPanel({ dep, store }: { dep: Dep; store: Store }) {
  const [ref, setRef] = useState('');
  const [pathsText, setPathsText] = useState(dep.refs.map((r) => r.path).join('\n'));
  const gpl = isGplFamily(dep.candidate?.license ?? dep.current.license);
  const toExternal =
    dep.candidate?.usage === 'external' || dep.current.usage === 'external';
  const uncovered = uncoveredRefPaths(dep);
  const bind = () => {
    const paths = pathsText
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!ref.trim() || paths.length === 0) return;
    const grant: Omit<LegalGrant, 'id' | 'active'> = {
      ref: ref.trim(),
      scopePaths: paths,
      approvedAt: new Date().toISOString(),
    };
    store.addGrant(dep.id, grant);
    setRef('');
  };
  return (
    <div className="subpanel">
      <div className="box-title">
        <Scale size={14} /> 法务授权
      </div>
      {gpl && toExternal && (
        <p className="hint warn-hint">
          GPL 系由内部使用升级为对外分发，须绑定覆盖全部引用路径的法务授权。
          {uncovered.length > 0 && <> 当前未覆盖：{uncovered.join('、')}</>}
        </p>
      )}
      {dep.grants.length === 0 ? (
        <p className="hint">暂无授权记录。</p>
      ) : (
        <ul className="grant-list">
          {dep.grants.map((g) => (
            <li key={g.id}>
              <div>
                <b>{g.ref}</b>
                <small>{new Date(g.approvedAt).toLocaleDateString('zh-CN')}</small>
              </div>
              <span className="grant-paths">{g.scopePaths.join('、')}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="propose-grid compact">
        <label>
          授权文号
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="如 LEGAL-2026-007"
          />
        </label>
        <label className="span2">
          覆盖引用路径（每行一个）
          <textarea
            rows={2}
            value={pathsText}
            onChange={(e) => setPathsText(e.target.value)}
          />
        </label>
      </div>
      <button className="primary sm" onClick={bind}>
        绑定授权
      </button>
    </div>
  );
}

function Detail({ dep, store }: { dep: Dep; store: Store }) {
  const c = dep.candidate;
  const diff = c ? store.diffs.get(dep.id) : undefined;
  const changed = new Set(diff?.changes ?? []);
  const blockers = store.gplBlockers(dep);
  const gplHit =
    c?.license &&
    isGplFamily(c.license) &&
    dep.current.usage === 'internal' &&
    c.usage === 'external';

  return (
    <div className="detail-panel">
      <div className="detail-top">
        <div>
          <span className="eyebrow">CURRENT {dep.current.version}</span>
          <h2>{dep.name}</h2>
        </div>
        <VerdictPill dep={dep} />
      </div>

      {c ? (
        <>
          <div className="candidate-head">
            <span>
              候选版本 <b>{c.version}</b>
            </span>
            <i
              className="license-tag"
              style={{
                color: licenseColor[c.license] || '#888',
                background: (licenseColor[c.license] || '#888') + '18',
              }}
            >
              {c.license}
            </i>
          </div>

          <div className="diff-block">
            <FieldDiff
              label="版本"
              oldV={dep.current.version}
              newV={c.version}
              changed={changed.has('version')}
            />
            <FieldDiff
              label="许可证"
              oldV={dep.current.license}
              newV={c.license}
              changed={changed.has('license')}
            />
            <FieldDiff
              label="版权声明"
              oldV={dep.current.copyright}
              newV={c.copyright}
              changed={changed.has('copyright')}
            />
            <FieldDiff
              label="来源"
              oldV={dep.current.source}
              newV={c.source}
              changed={changed.has('source')}
            />
            <FieldDiff
              label="使用范围"
              oldV={usageLabel(dep.current.usage)}
              newV={usageLabel(c.usage)}
              changed={changed.has('usage')}
            />
          </div>

          {diff?.needsReview && (
            <div className="review-note">
              <AlertTriangle size={14} />
              <div>
                <b>需复核：{changeSummary(diff.changes)}发生变化</b>
                <ul>
                  {diff.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {gplHit && (
            <div className="review-note gpl">
              <Lock size={14} />
              <div>
                <b>GPL 对外分发闸门</b>
                <p>
                  {blockers.length > 0
                    ? blockers.join('；')
                    : '已取得覆盖全部引用路径的法务授权，可提交审核。'}
                </p>
              </div>
            </div>
          )}

          {dep.review?.verdict === 'rejected' && dep.review.reason && (
            <div className="review-note rejected">
              <Ban size={14} />
              <div>
                <b>已驳回</b>
                <p>{dep.review.reason}</p>
              </div>
            </div>
          )}

          <div className="review-actions">
            {dep.review?.verdict !== 'approved' && (
              <button
                className="approve"
                onClick={() =>
                  store.review(dep.id, 'approved', 'Zen Li（法务）')
                }
              >
                <Check size={14} /> 审核通过
              </button>
            )}
            {dep.review?.verdict !== 'rejected' && (
              <button
                className="reject"
                onClick={() =>
                  store.review(dep.id, 'rejected', 'Zen Li（法务）', '差异未澄清')
                }
              >
                <Ban size={14} /> 驳回
              </button>
            )}
            <button
              className="promote"
              disabled={dep.review?.verdict !== 'approved'}
              title={
                dep.review?.verdict !== 'approved'
                  ? '仅已审核候选可替换当前版本'
                  : '替换当前版本'
              }
              onClick={() => store.promote(dep.id)}
            >
              <ShieldCheck size={14} /> 替换为当前版本
            </button>
            <button className="ghost" onClick={() => store.withdraw(dep.id)}>
              <RotateCcw size={14} /> 撤回候选
            </button>
          </div>
          {dep.review?.verdict !== 'approved' && (
            <p className="hint lock-hint">
              <Lock size={11} /> 未审核通过前，当前版本 {dep.current.version} 不会被替换。
            </p>
          )}
        </>
      ) : (
        <CandidateForm dep={dep} onPropose={store.propose} />
      )}

      <RefsPanel dep={dep} store={store} />
      <GrantsPanel dep={dep} store={store} />

      <div className="subpanel">
        <div className="box-title">
          <History size={14} /> 已审核版本
        </div>
        {dep.approvedVersions.length === 0 ? (
          <p className="hint">暂无历史已审核版本。</p>
        ) : (
          <ul className="history-list">
            {dep.approvedVersions.map((v) => (
              <li key={v.version + v.approvedAt}>
                <b>{v.version}</b>
                <i>{v.license}</i>
                <small>{new Date(v.approvedAt).toLocaleString('zh-CN')}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ConflictsView({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0)
    return (
      <div className="empty-side">
        <ShieldCheck size={22} />
        <b>暂无冲突</b>
        <p>刷新后依赖、路径、授权、批次与当前版本一致。</p>
      </div>
    );
  return (
    <ul className="conflict-list">
      {conflicts.map((c) => (
        <li key={c.id}>
          <div className="conflict-head">
            <FileWarning size={14} />
            <b>{c.depName}</b>
            <code className="rule-tag">{c.rule}</code>
          </div>
          <p className="conflict-title">{c.title}</p>
          <div className="conflict-license">
            <span className="old">{c.oldLicense}</span>
            <ArrowRight size={11} />
            <span className="new">{c.newLicense}</span>
          </div>
          <p className="conflict-detail">{c.detail}</p>
          <div className="conflict-paths">
            {c.refPaths.map((p) => (
              <code key={p}>{p}</code>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function BatchView({ store }: { store: Store }) {
  const { state } = store;
  const [parentId, setParentId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [extraDeps, setExtraDeps] = useState<number[]>([]);

  const frozen = state.batches.filter((b) => b.status === 'frozen');
  const parent = state.batches.find((b) => b.id === parentId) || null;
  const freezable = selectBatchItems(state.deps, state.batches);

  const toggleExtra = (id: number) =>
    setExtraDeps((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const doSupplement = () => {
    if (!parent || !reason.trim() || extraDeps.length === 0) return;
    const byId = new Map(freezable.map((s) => [s.dep.id, s.item]));
    const items: NoticeBatchItem[] = extraDeps
      .map((id) => byId.get(id))
      .filter((i): i is NoticeBatchItem => Boolean(i));
    store.supplement(parent.id, items, reason);
    setReason('');
    setExtraDeps([]);
    setParentId('');
  };

  return (
    <div className="batch-view">
      <button
        className="primary full"
        onClick={() => store.freeze()}
        disabled={freezable.length === 0}
      >
        <Snowflake size={14} /> 冻结当前候选为通知批次
      </button>
      <p className="hint">批次创建即冻结，不再随后续变化改动。</p>

      {state.batches.length === 0 && (
        <div className="empty-side small">
          <Send size={18} />
          <p>尚无通知批次</p>
        </div>
      )}

      <ul className="batch-list">
        {[...state.batches].reverse().map((b: NoticeBatch) => (
          <li key={b.id} className={`batch ${b.status}`}>
            <div className="batch-head">
              <b>{b.id}</b>
              <span className={`batch-status ${b.status}`}>
                {b.status === 'frozen' ? '已冻结' : b.status === 'withdrawn' ? '已撤回' : '补录版'}
              </span>
            </div>
            <small className="batch-time">
              {new Date(b.frozenAt).toLocaleString('zh-CN')}
            </small>
            {b.parentId && (
              <p className="supplement">
                <CopyPlus size={12} /> 补录自 {b.parentId}
              </p>
            )}
            {b.supplementReason && (
              <p className="supplement-reason">补录原因：{b.supplementReason}</p>
            )}
            <ul className="batch-items">
              {b.items.map((it) => (
                <li key={it.depId + it.version}>
                  <b>{it.name}</b> <span>{it.version}</span>{' '}
                  <i>{it.license}</i>
                  <small>（{it.changeSummary}）</small>
                </li>
              ))}
            </ul>
            {b.status === 'frozen' && (
              <button
                className="ghost sm"
                onClick={() => store.withdrawOneBatch(b.id)}
              >
                <RotateCcw size={12} /> 撤回（仅恢复最近已审核版本）
              </button>
            )}
          </li>
        ))}
      </ul>

      {frozen.length > 0 && (
        <div className="supplement-box">
          <div className="box-title">
            <CopyPlus size={14} /> 补录批次（另建带原因版本）
          </div>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">选择已冻结批次…</option>
            {frozen.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id}（{b.items.length} 项）
              </option>
            ))}
          </select>
          <label className="check-line">
            漏发依赖：
            {freezable.map(({ dep: dd, item }) => (
              <label key={dd.id} className="chip-check">
                <input
                  type="checkbox"
                  checked={extraDeps.includes(dd.id)}
                  onChange={() => toggleExtra(dd.id)}
                />
                {dd.name}@{item.version}
              </label>
            ))}
          </label>
          <textarea
            rows={2}
            placeholder="补录原因（必填）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="primary sm"
            disabled={!parent || !reason.trim() || extraDeps.length === 0}
            onClick={doSupplement}
          >
            生成补录批次
          </button>
        </div>
      )}
    </div>
  );
}

export default function UpgradeReview({ store }: { store: Store }) {
  const [selected, setSelected] = useState(store.state.deps[0]?.id ?? 0);
  const [sideTab, setSideTab] = useState<'conflicts' | 'batches'>('conflicts');
  const dep = store.state.deps.find((d) => d.id === selected) ?? null;

  const stats = useMemo(() => {
    const deps = store.state.deps;
    return {
      total: deps.length,
      pending: deps.filter((d) => d.review?.verdict === 'pending').length,
      approved: deps.filter((d) => d.review?.verdict === 'approved').length,
      blocked: store.conflicts.length,
    };
  }, [store.state.deps, store.conflicts.length]);

  return (
    <section className="compliance">
      <div className="comp-toolbar">
        <div>
          <h2>依赖升级合规差异审查</h2>
          <p>
            每个依赖记录当前版本、候选版本与引用路径；许可证 / 版权 / 来源变化进入复核，GPL
            对外分发须授权覆盖路径。
          </p>
        </div>
        <div className="toolbar-actions">
          <button className="outline" onClick={store.reset}>
            <RotateCcw size={14} /> 重置演示数据
          </button>
          <button className="primary" onClick={store.rescan}>
            <RefreshCw size={14} /> 重新扫描（刷新对齐）
          </button>
        </div>
      </div>

      <div className="comp-stats">
        <div>
          <span>依赖</span>
          <b>{stats.total}</b>
        </div>
        <div>
          <span>待复核候选</span>
          <b className="orange">{stats.pending}</b>
        </div>
        <div>
          <span>已审核待替换</span>
          <b className="teal">{stats.approved}</b>
        </div>
        <div>
          <span>刷新冲突</span>
          <b className="red">{stats.blocked}</b>
        </div>
        {store.lastScannedAt && (
          <small className="scan-time">
            上次刷新 {new Date(store.lastScannedAt).toLocaleTimeString('zh-CN')}
          </small>
        )}
      </div>

      <div className="comp-grid">
        <div className="comp-list">
          {store.state.deps.map((d) => (
            <button
              key={d.id}
              className={d.id === selected ? 'comp-row on' : 'comp-row'}
              onClick={() => setSelected(d.id)}
            >
              <span className="comp-name">{d.name}</span>
              <span className="comp-versions">
                {d.current.version}
                {d.candidate && (
                  <>
                    <ArrowRight size={11} />
                    <b>{d.candidate.version}</b>
                  </>
                )}
              </span>
              <span className="comp-licenses">
                <i
                  className="license-tag sm"
                  style={{
                    color: licenseColor[d.current.license] || '#888',
                    background: (licenseColor[d.current.license] || '#888') + '18',
                  }}
                >
                  {d.current.license}
                </i>
                {d.candidate && d.candidate.license !== d.current.license && (
                  <i
                    className="license-tag sm"
                    style={{
                      color: licenseColor[d.candidate.license] || '#888',
                      background: (licenseColor[d.candidate.license] || '#888') + '18',
                    }}
                  >
                    {d.candidate.license}
                  </i>
                )}
              </span>
              <VerdictPill dep={d} />
            </button>
          ))}
        </div>

        {dep ? (
          <Detail dep={dep} store={store} />
        ) : (
          <div className="detail-panel empty-side">请选择依赖</div>
        )}

        <div className="comp-side">
          <div className="side-tabs">
            <button
              className={sideTab === 'conflicts' ? 'on' : ''}
              onClick={() => setSideTab('conflicts')}
            >
              <FileWarning size={13} /> 冲突 {store.conflicts.length > 0 && `(${store.conflicts.length})`}
            </button>
            <button
              className={sideTab === 'batches' ? 'on' : ''}
              onClick={() => setSideTab('batches')}
            >
              <Send size={13} /> 通知批次
            </button>
          </div>
          <div className="side-body">
            {sideTab === 'conflicts' ? (
              <ConflictsView conflicts={store.conflicts} />
            ) : (
              <BatchView store={store} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
