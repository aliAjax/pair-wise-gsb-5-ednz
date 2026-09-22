import {useMemo, useState} from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  Check,
  ChevronDown,
  ClipboardList,
  Download,
  FileCode2,
  FilePlus2,
  GitBranch,
  History,
  Info,
  Layers3,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Stamp,
  Upload,
} from 'lucide-react';
import {useStore} from './ui/useStore';
import {store} from './data/store';
import type {Batch, Dep, NotificationItem} from './domain/types';
import {
  activeAuthorizations,
  activePaths,
  authorizationCovers,
  currentRecord,
  evaluateCandidate,
  isGplFamily,
  riskOf,
  uncoveredExternalGplRefs,
  uniqueActivePathKeys,
} from './rules/compliance';

type View = 'deps' | 'queue' | 'batches' | 'conflicts';

const licenseColors: Record<string, string> = {
  MIT: '#35b995',
  'BSD-3-Clause': '#6d9ee8',
  'GPL-3.0': '#ec8c75',
  'GPL-2.0': '#e59c66',
  'LGPL-2.1': '#d7a55c',
  'LGPL-3.0': '#d78b5c',
  'AGPL-3.0': '#e0725f',
  'Apache-2.0': '#b18ee4',
};

const colorOf = (lic: string) =>
  licenseColors[lic] || (isGplFamily(lic) ? '#e0725f' : '#8d9ca1');

const fmt = (t?: number) =>
  !t ? '' : new Date(t).toLocaleString('zh-CN', {hour12: false});

const kindText: Record<NotificationItem['kind'], string> = {
  'unapproved-candidate': '未审核候选',
  'review-required': '差异复核',
  'gpl-external': 'GPL 对外分发',
  conflict: '刷新冲突',
};

export default function App() {
  const state = useStore();
  const {deps, queue, batches, conflicts} = state;
  const [view, setView] = useState<View>('deps');
  const [selected, setSelected] = useState<number>(() => deps[0]?.id ?? 0);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<{ok: boolean; text: string} | null>(null);

  const flash = (r: {ok: boolean; reason?: string}, okText: string) =>
    setToast(r.ok ? {ok: true, text: okText} : {ok: false, text: r.reason || '操作失败'});

  const depStatus = useMemo(() => {
    const map = new Map<number, 'ok' | 'warn' | 'risk'>();
    for (const d of deps) {
      const uncovered = uncoveredExternalGplRefs(state, d).length > 0;
      const hasConflict = conflicts.some(
        (c) => c.depId === d.id && c.severity === 'risk',
      );
      const cur = currentRecord(d);
      if (uncovered || hasConflict) map.set(d.id, 'risk');
      else if (
        (cur && isGplFamily(cur.license)) ||
        d.candidates.some((c) => !c.reviewed && evaluateCandidate(d, c).needsReview)
      )
        map.set(d.id, 'warn');
      else map.set(d.id, riskOf(cur?.license ?? '', false));
    }
    return map;
  }, [deps, state, conflicts]);

  const filtered = useMemo(
    () =>
      deps.filter((d) =>
        `${d.name}${currentRecord(d)?.license ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [deps, query],
  );

  const current = deps.find((d) => d.id === selected);
  const riskCount = [...depStatus.values()].filter((s) => s === 'risk').length;

  const exportMd = () => {
    const lines = [
      '# License Lens — 依赖升级合规差异审查报告',
      `生成时间：${fmt(Date.now())}`,
      '',
      '## 当前版本与候选版本',
      '| 依赖 | 当前版本 | 候选版本 | 许可证 | 引用路径 | 状态 |',
      '|---|---|---|---|---|---|',
      ...deps.map((d) => {
        const cur = currentRecord(d);
        const keys = [...uniqueActivePathKeys(d)];
        const cands = d.candidates.map((c) => `${c.version}${c.reviewed ? '（已审核）' : '（未审核）'}`).join('、');
        return `| ${d.name} | ${d.currentVersion} | ${cands || '—'} | ${cur?.license ?? ''} | ${keys.join('；') || '（无）'} | ${depStatus.get(d.id)} |`;
      }),
      '',
      '## 活通知清单（未冻结）',
      ...(queue.length ? queue.map((n) => `- [${kindText[n.kind]}] ${n.depName} ${n.version ?? ''} ${n.path ?? ''}：${n.detail}`) : ['（无）']),
      '',
      '## 已冻结批次',
      ...(batches.length
        ? batches.flatMap((b) => [
            `### 批次 #${b.number}（${fmt(b.createdAt)}）${b.note ? ` ${b.note}` : ''}`,
            ...b.items.map((i) => `- [${kindText[i.kind]}] ${i.depName} ${i.version} ${i.path}：${i.title}`),
          ])
        : ['（无）']),
      '',
      '## 刷新冲突',
      ...(conflicts.length
        ? conflicts.map((c) => `- [${c.ruleCode}] ${c.depName}：${c.oldLicense} → ${c.newLicense}｜${c.path}｜${c.rule}`)
        : ['（无）']),
    ];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], {type: 'text/markdown'}));
    a.download = 'license-lens-report.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon"><ShieldCheck size={18} /></div>
          <div><b>License Lens</b><small>upgrade compliance</small></div>
        </div>
        <div className="nav-title">WORKSPACE</div>
        <button className={view === 'deps' ? 'nav active' : 'nav'} onClick={() => setView('deps')}>
          <Layers3 size={16} />依赖总览 <span>{deps.length}</span>
        </button>
        <button className={view === 'queue' ? 'nav active' : 'nav'} onClick={() => setView('queue')}>
          <ClipboardList size={16} />待处理通知 <span className={queue.length ? 'red' : ''}>{queue.length}</span>
        </button>
        <button className={view === 'batches' ? 'nav active' : 'nav'} onClick={() => setView('batches')}>
          <Snowflake size={16} />冻结批次 <span>{batches.length}</span>
        </button>
        <button className={view === 'conflicts' ? 'nav active' : 'nav'} onClick={() => setView('conflicts')}>
          <AlertTriangle size={16} />刷新冲突 <span className={conflicts.length ? 'red' : ''}>{conflicts.length}</span>
        </button>
        <div className="aside-bottom">
          <div className="mini-card">
            <Sparkles size={16} />
            <div><b>合规差异审查已启用</b><small>当前 {riskCount} 个依赖存在高风险项</small></div>
          </div>
          <div className="user">
            <div className="avatar">ZL</div><span>Zen Li</span><ChevronDown size={14} />
          </div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">WORKSPACE / <b>UPGRADE REVIEW</b></div>
            <h1>依赖升级合规差异审查</h1>
            <p>记录当前版本、候选版本与引用路径；许可证、版权声明或来源变化进入复核。</p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={exportMd}><Download size={15} />导出报告</button>
            <button
              className="outline"
              onClick={() => {
                store.refresh();
                const n = store.getState().conflicts.length;
                setToast(n
                  ? {ok: false, text: `刷新发现 ${n} 项冲突，已在「刷新冲突」中列出（依赖/旧新许可证/引用路径/命中规则）`}
                  : {ok: true, text: '刷新完成：依赖、路径、授权、批次与当前版本一致'});
              }}
            >
              <RefreshCw size={15} />刷新校验
            </button>
            <button
              className="outline"
              disabled={queue.length === 0}
              title={queue.length ? '冻结当前通知清单，快照不可变' : '活清单为空'}
              onClick={() => {
                const b = store.freezeBatch();
                setToast({ok: true, text: `批次 #${b.number} 已冻结，清单快照不可修改`});
              }}
            >
              <Snowflake size={15} />冻结批次{queue.length ? `（${queue.length}）` : ''}
            </button>
            <button className="primary" onClick={() => setShowAdd(true)}><Plus size={16} />添加依赖</button>
          </div>
        </header>

        <section className="summary">
          <div><span>全部依赖</span><b>{deps.length}</b><small>当前版本均已留痕</small></div>
          <div>
            <span>未审核候选</span>
            <b className="orange">{deps.reduce((n, d) => n + d.candidates.filter((c) => !c.reviewed).length, 0)}</b>
            <small>未审核不得替换当前版本（R1）</small>
          </div>
          <div>
            <span>待复核差异</span>
            <b className="orange">{queue.filter((n) => n.kind === 'review-required').length}</b>
            <small>许可证 / 版权 / 来源变化（R2）</small>
          </div>
          <div>
            <span>GPL 未授权对外分发</span>
            <b className="red">{queue.filter((n) => n.kind === 'gpl-external').length}</b>
            <small>须绑定覆盖路径的法务授权（R3）</small>
          </div>
        </section>

        {toast && (
          <div className={toast.ok ? 'toast ok' : 'toast err'} onClick={() => setToast(null)}>
            {toast.ok ? <Check size={14} /> : <AlertTriangle size={14} />}
            {toast.text}
          </div>
        )}

        {view === 'deps' && (
          <section className="workspace">
            <div className="table-pane">
              <div className="pane-head">
                <div><h2>依赖清单</h2><p>当前版本 · 候选版本 · 引用路径</p></div>
                <div className="tools">
                  <div className="search">
                    <Search size={15} />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索依赖" />
                  </div>
                </div>
              </div>
              <div className="table">
                <div className="tr th"><span>依赖名称</span><span>当前 → 候选</span><span>许可证</span><span>状态</span></div>
                {filtered.map((d) => {
                  const cur = currentRecord(d);
                  const st = depStatus.get(d.id) ?? 'ok';
                  const pending = d.candidates.filter((c) => !c.reviewed).length;
                  return (
                    <button
                      key={d.id}
                      className={d.id === selected ? 'tr selected' : 'tr'}
                      onClick={() => setSelected(d.id)}
                    >
                      <span className="dep-name"><span className="pkg-dot" /> {d.name}
                        <small className="sub">引用 {activePaths(d).length} 处</small>
                      </span>
                      <span className="muted">
                        {d.currentVersion}
                        {d.candidates.length > 0 && (
                          <em className={pending ? 'cand-pending' : 'cand-ok'}>
                            {' → '}
                            {d.candidates.map((c) => c.version).join('、')}
                            {pending ? `（${pending} 未审核）` : '（已审核）'}
                          </em>
                        )}
                      </span>
                      <span>
                        <i className="license" style={{color: colorOf(cur?.license ?? ''), background: colorOf(cur?.license ?? '') + '18'}}>
                          {cur?.license}
                        </i>
                      </span>
                      <span className={'status ' + st}>
                        {st === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
                        {st === 'ok' ? '安全' : st === 'warn' ? '复核' : '高风险'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {current ? (
              <DepDetail
                dep={current}
                state={state}
                status={depStatus.get(current.id) ?? 'ok'}
                flash={flash}
              />
            ) : (
              <div className="detail"><p className="muted">请选择一个依赖。</p></div>
            )}
          </section>
        )}

        {view === 'queue' && <QueueView queue={queue} onFreeze={() => {
          const b = store.freezeBatch();
          setToast({ok: true, text: `批次 #${b.number} 已冻结`});
        }} />}

        {view === 'batches' && <BatchesView batches={batches} />}

        {view === 'conflicts' && <ConflictsView conflicts={conflicts} refreshedAt={state.lastRefreshedAt} />}
      </main>

      {showAdd && <AddDepModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

/* ================= 依赖详情 ================= */

function DepDetail({
  dep,
  state,
  status,
  flash,
}: {
  dep: Dep;
  state: ReturnType<typeof useStore>;
  status: 'ok' | 'warn' | 'risk';
  flash: (r: {ok: boolean; reason?: string}, ok: string) => void;
}) {
  const cur = currentRecord(dep)!;
  const gpl = isGplFamily(cur.license);
  const auths = activeAuthorizations(state).filter((a) => a.depId === dep.id);
  const uncovered = uncoveredExternalGplRefs(state, dep);
  const paths = activePaths(dep);
  const removed = dep.paths.filter((p) => p.removedAt);
  const [cv, setCv] = useState({version: '', license: cur.license, copyright: '', source: cur.source, note: ''});
  const [pv, setPv] = useState({path: '', scope: 'internal' as 'internal' | 'external'});
  const [bf, setBf] = useState({version: '', license: cur.license, copyright: '', source: cur.source, reason: ''});
  const [authFor, setAuthFor] = useState<string | null>(null);
  const [approver, setApprover] = useState('法务-王敏');

  const counts = [...uniqueActivePathKeys(dep)].map((k) => {
    const refs = paths.filter((p) => p.path.replace(/\/+$/, '') === k);
    return {key: k, count: refs.length, first: refs[0]};
  });

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-icon" style={{background: colorOf(cur.license) + '1c', color: colorOf(cur.license)}}>
          <FileCode2 size={20} />
        </div>
        <div><span>SELECTED DEPENDENCY</span><h2>{dep.name}</h2></div>
        <span className={'status ' + status} style={{marginLeft: 'auto'}}>
          {status === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
          {status === 'ok' ? '安全' : status === 'warn' ? '复核' : '高风险'}
        </span>
      </div>

      <div className="detail-grid">
        <div><label>当前版本</label><b>{dep.currentVersion}</b></div>
        <div><label>许可证</label><b style={{color: colorOf(cur.license)}}>{cur.license}</b></div>
        <div><label>来源</label><b>{cur.source}</b></div>
      </div>
      <p className="copyright-line"><Info size={13} />版权声明：{cur.copyright || '（未登记）'}</p>

      {/* 候选版本 R1/R2 */}
      <Section icon={<GitBranch size={14} />} title="候选版本" hint="未审核候选版本不得替换当前版本（R1）；许可证/版权/来源变化进入复核（R2）">
        {dep.candidates.length === 0 && <Empty>暂无候选版本</Empty>}
        {dep.candidates.map((c) => {
          const ev = evaluateCandidate(dep, c);
          return (
            <div className="cand-card" key={c.version}>
              <div className="cand-top">
                <b>{c.version}</b>
                <i className="license" style={{color: colorOf(c.license), background: colorOf(c.license) + '18'}}>{c.license}</i>
                {c.reviewed
                  ? <span className="tag-ok"><Check size={11} />已审核{c.reviewedBy ? ` · ${c.reviewedBy}` : ''}</span>
                  : <span className="tag-pending"><AlertTriangle size={11} />未审核</span>}
                {ev.needsReview && <span className="tag-warn">差异复核（{ev.changes.length} 项）</span>}
              </div>
              {ev.changes.length > 0 && (
                <ul className="diff-list">
                  {ev.changes.map((h) => (
                    <li key={h.field}><span>{h.field}</span><code>{h.from}</code><ArrowLeftRight size={12} /><code>{h.to}</code></li>
                  ))}
                </ul>
              )}
              {c.note && <p className="cand-note">{c.note}</p>}
              <div className="row-actions">
                {!c.reviewed && (
                  <button className="mini outline" onClick={() => {
                    store.reviewCandidate(dep.id, c.version);
                    flash({ok: true}, `候选 ${c.version} 已通过复核`);
                  }}><Stamp size={13} />复核通过</button>
                )}
                <button
                  className="mini primary"
                  disabled={!c.reviewed}
                  title={c.reviewed ? '替换当前版本' : '未审核候选版本不得替换当前版本（R1）'}
                  onClick={() => flash(store.applyCandidate(dep.id, c.version), `${c.version} 已替换当前版本`)}
                >
                  <Upload size={13} />替换当前版本
                </button>
              </div>
            </div>
          );
        })}
        <details className="inline-form">
          <summary><FilePlus2 size={13} />登记新候选版本</summary>
          <div className="form-grid">
            <input placeholder="版本号，如 2.0.0" value={cv.version} onChange={(e) => setCv({...cv, version: e.target.value})} />
            <select value={cv.license} onChange={(e) => setCv({...cv, license: e.target.value})}>
              {['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-2.0', 'GPL-3.0', 'LGPL-3.0', 'AGPL-3.0'].map((l) => <option key={l}>{l}</option>)}
            </select>
            <input placeholder="版权声明" value={cv.copyright} onChange={(e) => setCv({...cv, copyright: e.target.value})} />
            <input placeholder="来源，如 npm / 手动" value={cv.source} onChange={(e) => setCv({...cv, source: e.target.value})} />
            <button className="mini primary" onClick={() => {
              if (!cv.version.trim()) return;
              store.addCandidate(dep.id, {...cv, version: cv.version.trim()});
              setCv({version: '', license: cur.license, copyright: '', source: cur.source, note: ''});
              flash({ok: true}, '候选版本已登记，等待复核');
            }}><Plus size={13} />登记</button>
          </div>
        </details>
      </Section>

      {/* 版本历史：撤回 R5 / 补录 R6 */}
      <Section icon={<History size={14} />} title="版本记录" hint="撤回只恢复最近已审核版本（R5）；补录另建带原因版本（R6）">
        <div className="ver-list">
          {dep.history.map((v, i) => {
            const r = dep.versions[v];
            return (
              <div key={v} className={v === dep.currentVersion ? 'ver-row current' : 'ver-row'}>
                <b>{v}</b>
                <i className="license" style={{color: colorOf(r.license), background: colorOf(r.license) + '18'}}>{r.license}</i>
                {v === dep.currentVersion && <span className="tag-ok">当前</span>}
                {i === dep.history.length - 1 && dep.history.length > 1 && <span className="tag-muted">最近审核</span>}
                {r.withdrawnAt && <span className="tag-err">已撤回 {fmt(r.withdrawnAt)}</span>}
                {r.backfill && <span className="tag-warn" title={r.backfillReason}>补录：{r.backfillReason}</span>}
              </div>
            );
          })}
          {Object.values(dep.versions).filter((r) => r.backfill && !dep.history.includes(r.version)).map((r) => (
            <div key={r.version} className="ver-row">
              <b>{r.version}</b>
              <i className="license" style={{color: colorOf(r.license), background: colorOf(r.license) + '18'}}>{r.license}</i>
              <span className="tag-warn">补录：{r.backfillReason}</span>
            </div>
          ))}
        </div>
        <div className="row-actions">
          <button className="mini outline" onClick={() => flash(store.withdrawCurrent(dep.id), '已恢复到最近的已审核版本（R5）')}>
            <RotateCcw size={13} />撤回当前版本
          </button>
        </div>
        <details className="inline-form">
          <summary><FilePlus2 size={13} />补录历史版本（必须填写原因）</summary>
          <div className="form-grid">
            <input placeholder="补录版本号" value={bf.version} onChange={(e) => setBf({...bf, version: e.target.value})} />
            <select value={bf.license} onChange={(e) => setBf({...bf, license: e.target.value})}>
              {['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-2.0', 'GPL-3.0', 'LGPL-3.0', 'AGPL-3.0'].map((l) => <option key={l}>{l}</option>)}
            </select>
            <input placeholder="版权声明" value={bf.copyright} onChange={(e) => setBf({...bf, copyright: e.target.value})} />
            <input placeholder="来源" value={bf.source} onChange={(e) => setBf({...bf, source: e.target.value})} />
            <input className="wide" placeholder="补录原因（必填）" value={bf.reason} onChange={(e) => setBf({...bf, reason: e.target.value})} />
            <button className="mini primary" onClick={() => flash(store.backfill(dep.id, bf), '补录版本已另建记录（R6）')}>
              <FilePlus2 size={13} />补录
            </button>
          </div>
        </details>
      </Section>

      {/* 引用路径 R4 */}
      <Section icon={<Link2 size={14} />} title="引用路径" hint="同一路径重复引用只保留一份义务；最后引用移除后才收回（R4）">
        <div className="path-list">
          {counts.map(({key, count, first}) => {
            const covered = authorizationCovers(state, dep, first);
            return (
              <div key={key} className="path-row">
                <code>{key}</code>
                <span className={first.scope === 'external' ? 'scope ext' : 'scope int'}>
                  {first.scope === 'external' ? <Upload size={11} /> : <Lock size={11} />}
                  {first.scope === 'external' ? '对外分发' : '内部使用'}
                </span>
                <span className="tag-muted">有效引用 × {count}</span>
                {gpl && first.scope === 'external' && (
                  covered
                    ? <span className="tag-ok" title={`${covered.approver} ${fmt(covered.approvedAt)}`}><ShieldCheck size={11} />法务授权已覆盖</span>
                    : <span className="tag-err"><AlertTriangle size={11} />缺少覆盖该路径的授权（R3）</span>
                )}
                <button className="mini ghost" onClick={() => store.removePath(dep.id, first.id)}>
                  <Ban size={12} />移除引用{count > 1 ? `（本路径还剩 ${count} 条）` : '（最后一条，义务收回）'}
                </button>
              </div>
            );
          })}
          {removed.map((p) => (
            <div key={p.id} className="path-row removed">
              <code>{p.path}</code>
              <span className="tag-muted">已移除 {fmt(p.removedAt)}</span>
              <button className="mini ghost" onClick={() => store.reinstatePath(dep.id, p.id)}>
                <RotateCcw size={12} />重新登记
              </button>
            </div>
          ))}
        </div>
        <div className="form-grid add-path">
          <input placeholder="引用路径，如 src/features/x.ts" value={pv.path} onChange={(e) => setPv({...pv, path: e.target.value})} />
          <select value={pv.scope} onChange={(e) => setPv({...pv, scope: e.target.value as 'internal' | 'external'})}>
            <option value="internal">内部使用</option>
            <option value="external">对外分发</option>
          </select>
          <button className="mini primary" onClick={() => {
            if (!pv.path.trim()) return;
            store.addPath(dep.id, pv.path, pv.scope);
            setPv({path: '', scope: 'internal'});
          }}><Plus size={13} />添加引用</button>
        </div>
      </Section>

      {/* GPL 授权 R3 */}
      {(gpl || auths.length > 0) && (
        <Section icon={<Scale size={14} />} title="法务授权" hint="GPL 系由内部使用升级为对外分发时，授权须绑定版本并覆盖引用路径（R3）">
          {auths.map((a) => (
            <div key={a.id} className="auth-card">
              <div>
                <b>授权 {a.id.slice(-6).toUpperCase()}</b>
                <span className="tag-muted">绑定版本 {a.version}</span>
                <span className="tag-ok">{a.approver} · {fmt(a.approvedAt)}</span>
              </div>
              <p className="cand-note">覆盖路径：{a.coveredPathIds
                .map((pid) => dep.paths.find((p) => p.id === pid)?.path)
                .filter(Boolean).join('、') || '（路径已不存在）'}
              </p>
              {a.note && <p className="cand-note">{a.note}</p>}
              {!a.revoked && (
                <div className="row-actions">
                  <button className="mini outline" onClick={() => store.revokeAuthorization(a.id)}><Ban size={13} />撤销授权</button>
                </div>
              )}
              {a.revoked && <span className="tag-err">已撤销 {fmt(a.revokedAt)}</span>}
            </div>
          ))}
          {uncovered.length > 0 && (
            <div className="auth-missing">
              <AlertTriangle size={14} />
              <div>
                <b>{uncovered.length} 条对外分发引用缺少授权</b>
                <p>当前版本 {dep.currentVersion}（{cur.license}）须绑定覆盖下列引用路径的法务授权后方可对外分发：</p>
                <ul>{uncovered.map((p) => <li key={p.id}><code>{p.path}</code></li>)}</ul>
              </div>
            </div>
          )}
          {uncovered.length > 0 && (
            <div className="form-grid">
              <select
                value={uncovered.some((p) => p.id === authFor) ? authFor! : uncovered[0].id}
                onChange={(e) => setAuthFor(e.target.value)}
              >
                {uncovered.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
              </select>
              <input placeholder="法务审批人" value={approver} onChange={(e) => setApprover(e.target.value)} />
              <button className="mini primary" onClick={() => {
                const refId = uncovered.some((p) => p.id === authFor) ? authFor! : uncovered[0].id;
                store.addAuthorization({
                  depId: dep.id,
                  version: dep.currentVersion,
                  coveredPathIds: [refId],
                  approver: approver.trim() || '法务',
                  note: '由 License Lens 差异审查登记，绑定当前版本与引用路径（R3）',
                });
                setAuthFor(null);
                flash({ok: true}, '法务授权已绑定版本并覆盖引用路径（R3）');
              }}><Scale size={13} />登记授权</button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

/* ================= 通知 / 批次 / 冲突视图 ================= */

function QueueView({queue, onFreeze}: {queue: NotificationItem[]; onFreeze: () => void}) {
  const icon = (k: NotificationItem['kind']) =>
    k === 'gpl-external' ? <Scale size={15} /> : k === 'review-required' ? <GitBranch size={15} /> : <AlertTriangle size={15} />;
  return (
    <section className="list-pane">
      <div className="pane-head">
        <div><h2>待处理通知清单</h2><p>活清单实时派生；冻结后形成不可变批次快照</p></div>
        <button className="primary" disabled={queue.length === 0} onClick={onFreeze}>
          <Snowflake size={15} />冻结为批次
        </button>
      </div>
      {queue.length === 0 ? <Empty big>活清单为空——已全部冻结或问题均已解决</Empty> : (
        <div className="note-list">
          {queue.map((n) => (
            <div key={n.id} className={'note-item kind-' + n.kind}>
              <span className="note-icon">{icon(n.kind)}</span>
              <div>
                <b>{n.title}</b>
                <p>{n.detail}</p>
                <small>{n.depName}{n.version ? ` · ${n.version}` : ''}{n.path ? ` · ${n.path}` : ''} · {kindText[n.kind]} · {fmt(n.createdAt)}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BatchesView({batches}: {batches: Batch[]}) {
  return (
    <section className="list-pane">
      <div className="pane-head"><div><h2>冻结批次</h2><p>批次冻结后不可修改；撤回/补录等后续动作只产生新版本与新批次</p></div></div>
      {batches.length === 0 ? <Empty big>尚未冻结任何批次</Empty> : batches.slice().reverse().map((b) => (
        <div key={b.id} className="batch-card">
          <div className="batch-head">
            <Snowflake size={15} /><b>批次 #{b.number}</b>
            <span className="tag-muted">{fmt(b.createdAt)}</span>
            <span className="tag-ok">{b.items.length} 项（已冻结，只读）</span>
            {b.note && <span className="tag-warn">{b.note}</span>}
          </div>
          <div className="note-list">
            {b.items.map((i, idx) => (
              <div key={idx} className="note-item frozen">
                <span className="note-icon">{i.kind === 'gpl-external' ? <Scale size={14} /> : <AlertTriangle size={14} />}</span>
                <div>
                  <b>{i.title}</b>
                  <p>{i.detail}</p>
                  <small>{i.depName}{i.version ? ` · ${i.version}` : ''}{i.path ? ` · ${i.path}` : ''} · {i.license} · {kindText[i.kind]}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ConflictsView({conflicts, refreshedAt}: {conflicts: ReturnType<typeof useStore>['conflicts']; refreshedAt: number}) {
  return (
    <section className="list-pane">
      <div className="pane-head">
        <div>
          <h2>刷新冲突</h2>
          <p>依赖、路径、授权、批次与当前版本的一致性差异{refreshedAt ? `· 上次刷新 ${fmt(refreshedAt)}` : '· 尚未刷新'}</p>
        </div>
        <button className="primary" onClick={() => store.refresh()}><RefreshCw size={15} />立即刷新</button>
      </div>
      {conflicts.length === 0 ? (
        <Empty big>未发现冲突——刷新后依赖、路径、授权、批次与当前版本一致</Empty>
      ) : (
        <div className="conflict-table">
          <div className="ctr th"><span>依赖</span><span>旧 → 新许可证</span><span>引用路径</span><span>命中规则</span><span>说明</span></div>
          {conflicts.map((c) => (
            <div key={c.id} className={'ctr sev-' + c.severity}>
              <span className="dep-name"><span className="pkg-dot" />{c.depName}</span>
              <span><i className="license" style={{color: colorOf(c.oldLicense), background: colorOf(c.oldLicense) + '18'}}>{c.oldLicense}</i>
                <ArrowLeftRight size={11} />
                <i className="license" style={{color: colorOf(c.newLicense), background: colorOf(c.newLicense) + '18'}}>{c.newLicense}</i></span>
              <span><code>{c.path}</code></span>
              <span><b className="rule-code">{c.ruleCode}</b><small>{c.rule}</small></span>
              <span className="muted">{c.detail}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ================= 添加依赖 ================= */

function AddDepModal({onClose}: {onClose: () => void}) {
  const [f, setF] = useState({name: '', license: 'MIT', copyright: '', source: 'npm', path: '', scope: 'internal' as 'internal' | 'external'});
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>添加依赖</h2><button onClick={onClose}>×</button></div>
        <label>依赖名称<input autoFocus value={f.name} onChange={(e) => setF({...f, name: e.target.value})} placeholder="例如 date-fns" /></label>
        <label>许可证
          <select value={f.license} onChange={(e) => setF({...f, license: e.target.value})}>
            {['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-2.0', 'GPL-3.0', 'LGPL-3.0', 'AGPL-3.0'].map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
        <label>版权声明<input value={f.copyright} onChange={(e) => setF({...f, copyright: e.target.value})} placeholder="Copyright ..." /></label>
        <label>来源<input value={f.source} onChange={(e) => setF({...f, source: e.target.value})} /></label>
        <label>引用路径<input value={f.path} onChange={(e) => setF({...f, path: e.target.value})} placeholder="例如 src/app/x.ts（可留空）" /></label>
        <label>引用用途
          <select value={f.scope} onChange={(e) => setF({...f, scope: e.target.value as 'internal' | 'external'})}>
            <option value="internal">内部使用</option>
            <option value="external">对外分发</option>
          </select>
        </label>
        <button className="primary full" onClick={() => {
          if (!f.name.trim()) return;
          store.addDep(f);
          onClose();
        }}><Plus size={15} />加入审查</button>
      </div>
    </div>
  );
}

/* ================= 小组件 ================= */

function Section({icon, title, hint, children}: {icon: React.ReactNode; title: string; hint: string; children: React.ReactNode}) {
  return (
    <div className="dsection">
      <div className="dsection-head">{icon}<b>{title}</b><small>{hint}</small></div>
      {children}
    </div>
  );
}

function Empty({children, big}: {children: React.ReactNode; big?: boolean}) {
  return <div className={big ? 'empty big' : 'empty'}>{children}</div>;
}
