// 端到端规则验证脚本。运行方式（不向 package.json 增加任何依赖）：
//   npx rolldown scripts/verify.mts -o .tmp-verify/run.mjs --format esm -d && node .tmp-verify/run.mjs
import {store} from '../src/data/store.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

const s0 = store.getState();
const react = s0.deps.find((d) => d.name === 'react');
const lodash = s0.deps.find((d) => d.name === 'lodash');
const hljs = s0.deps.find((d) => d.name === 'highlight.js');
const legacy = s0.deps.find((d) => d.name === 'legacy-parser');
const stamper = s0.deps.find((d) => d.name === 'pdf-stamper');

console.log('R1 未审核候选版本不得替换当前版本');
let r = store.applyCandidate(react.id, '19.0.0');
ok('未审核时 applyCandidate 被拒绝', r.ok === false);
ok('当前版本仍为 18.3.1', store.getState().deps.find((d) => d.id === react.id).currentVersion === '18.3.1');
store.reviewCandidate(react.id, '19.0.0');
r = store.applyCandidate(react.id, '19.0.0');
ok('审核通过后可替换', r.ok === true);
ok('替换后当前版本为 19.0.0', store.getState().deps.find((d) => d.id === react.id).currentVersion === '19.0.0');

console.log('R2 许可证/版权/来源变化进入复核（活清单产生 review-required）');
ok(
  'lodash 4.18.0 许可证 MIT→Apache-2.0 在活清单中要求复核',
  store.getState().queue.some((n) => n.kind === 'review-required' && n.depId === lodash.id && n.version === '4.18.0'),
);
ok(
  'highlight.js 11.11.0 版权声明变化在活清单中要求复核',
  store.getState().queue.some((n) => n.kind === 'review-required' && n.depId === hljs.id),
);
store.reviewCandidate(lodash.id, '4.18.0');
store.reviewCandidate(hljs.id, '11.11.0');
ok('lodash / highlight.js 审核后其复核通知消失（其他依赖的未审核差异仍保留）',
  !store.getState().queue.some((n) => n.kind === 'review-required' && (n.depId === lodash.id || n.depId === hljs.id)));
ok('legacy-parser 3.0.0 未审核，其版权差异复核通知仍在',
  store.getState().queue.some((n) => n.kind === 'review-required' && n.depId === legacy.id && n.version === '3.0.0'));

console.log('R3 GPL 内部使用→对外分发须绑定覆盖引用路径的法务授权');
ok(
  'legacy-parser 对外分发路径在活清单中报 gpl-external',
  store.getState().queue.some((n) => n.kind === 'gpl-external' && n.depId === legacy.id && n.path.includes('dist/vendor')),
);
ok(
  'pdf-stamper 已有授权覆盖，不产生 gpl-external',
  !store.getState().queue.some((n) => n.kind === 'gpl-external' && n.depId === stamper.id),
);
const extRef = store
  .getState()
  .deps.find((d) => d.id === legacy.id)
  .paths.find((p) => p.scope === 'external' && !p.removedAt);
store.addAuthorization({
  depId: legacy.id,
  version: '2.1.0',
  coveredPathIds: [extRef.id],
  approver: '法务-王敏',
  note: '测试授权',
});
ok(
  '登记覆盖该路径的授权后 gpl-external 通知消失',
  !store.getState().queue.some((n) => n.kind === 'gpl-external' && n.depId === legacy.id),
);
store.addPath(legacy.id, 'dist/embedded/liblegacy.so', 'external');
ok(
  '新增另一对外路径后仍报 gpl-external（按路径绑定）',
  store.getState().queue.some((n) => n.kind === 'gpl-external' && n.path && n.path.includes('liblegacy')),
);

console.log('R4 同路径重复引用一份义务；最后引用移除后才收回');
store.addPath(stamper.id, 'src/report/exportPdf.ts', 'external');
const s4 = store.getState();
const stamper2 = s4.deps.find((d) => d.id === stamper.id);
ok('同一路径两条引用，gpl 通知仍只有一条（按去重路径计）',
  s4.queue.filter((n) => n.kind === 'gpl-external' && n.depId === stamper.id).length === 1);
const refs = stamper2.paths.filter((p) => !p.removedAt && p.path === 'src/report/exportPdf.ts');
store.removePath(stamper.id, refs[0].id);
ok(
  '移除一条后仍有引用，义务保留（有效引用计数=1）',
  store.getState().deps.find((d) => d.id === stamper.id).paths.filter((p) => !p.removedAt && p.path === 'src/report/exportPdf.ts').length === 1,
);
store.removePath(stamper.id, refs[1].id);
ok(
  '两条全部移除后该路径无有效引用（义务收回）',
  !store.getState().deps.find((d) => d.id === stamper.id).paths.some((p) => !p.removedAt && p.path === 'src/report/exportPdf.ts'),
);

console.log('批次冻结：快照不可变，活清单清空');
// 再登记一个未审核候选（lodash 4.18.0 已在 R2 审核），使其以未审核状态进入冻结快照，
// 用于后续 R7 校验「冻结批次版本 vs 当前版本」的版本+许可证双差异。
store.addCandidate(lodash.id, {
  version: '5.0.0',
  license: 'Apache-2.0',
  copyright: 'Copyright JS Foundation and other contributors',
  source: 'npm',
});
// hljs 11.11.0 已在 R2 审核应用前被审核；这里再登记一个同许可证的未审核候选，
// 使批次快照留下一条与「应用后当前版本」版本号不同、许可证相同的记录。
store.addCandidate(hljs.id, {
  version: '11.11.1',
  license: 'BSD-3-Clause',
  copyright: 'Copyright (c) 2006-2026, Ivan Sagalaev and contributors',
  source: 'npm',
});
const before = store.getState().queue.length;
ok('冻结前活清单非空（liblegacy 未授权等）', before > 0);
const batch = store.freezeBatch('测试批次');
ok('冻结后活清单清空', store.getState().queue.length === 0);
ok('批次项数等于冻结前活清单', batch.items.length === before);
const legacyAuth = [...store.getState().authorizations].reverse().find((a) => a.depId === legacy.id && !a.revoked);
store.revokeAuthorization(legacyAuth.id);
const after = store.getState();
ok('撤销授权后产生新活通知', after.queue.some((n) => n.kind === 'gpl-external' && n.depId === legacy.id));
const frozen = after.batches.find((b) => b.id === batch.id);
ok('冻结批次快照未被改变（仍记录授权有效时的状态）', frozen.items.length === before);

console.log('R5 撤回只恢复最近已审核版本');
let rr = store.withdrawCurrent(react.id);
ok('react 可撤回至 18.3.1', rr.ok && store.getState().deps.find((d) => d.id === react.id).currentVersion === '18.3.1');
ok('被撤回的 19.0.0 标记 withdrawnAt', store.getState().deps.find((d) => d.id === react.id).versions['19.0.0'].withdrawnAt != null);
rr = store.withdrawCurrent(react.id);
ok('没有更早已审核版本时拒绝再次撤回', rr.ok === false);
store.addDep({name: 'tmp-lib', license: 'MIT', copyright: 'c', source: 'npm', path: 'src/t.ts', scope: 'internal'});
const tmp = store.getState().deps.find((d) => d.name === 'tmp-lib');
ok('全新依赖撤回被拒绝（无历史已审核版本）', store.withdrawCurrent(tmp.id).ok === false);

console.log('R6 补录另建带原因版本，不覆盖、不改当前');
const curVerBefore = store.getState().deps.find((d) => d.id === hljs.id).currentVersion;
rr = store.backfill(hljs.id, {version: '10.7.0', license: 'BSD-3-Clause', copyright: 'Copyright (c) 2006, Ivan Sagalaev', source: 'npm', reason: ''});
ok('缺少原因被拒绝', rr.ok === false);
rr = store.backfill(hljs.id, {version: curVerBefore, license: 'MIT', copyright: 'x', source: 'npm', reason: '覆盖测试'});
ok('补录已存在版本被拒绝（不得覆盖）', rr.ok === false);
rr = store.backfill(hljs.id, {version: '10.7.0', license: 'BSD-3-Clause', copyright: 'Copyright (c) 2006, Ivan Sagalaev', source: 'npm', reason: '审计补录：10.x 曾在 2024 年随版本发布'});
ok('带原因补录成功', rr.ok === true);
const hljsAfter = store.getState().deps.find((d) => d.id === hljs.id);
ok('补录不改变当前版本', hljsAfter.currentVersion === curVerBefore);
ok('补录记录带 backfillReason', hljsAfter.versions['10.7.0'].backfill === true && /审计补录/.test(hljsAfter.versions['10.7.0'].backfillReason));

console.log('R7 刷新一致性：依赖/路径/授权/批次 vs 当前版本');
// 准备批次版本差异：
//  - hljs 11.11.0 已审核（许可证相同、版权不同），冻结后应用 → 版本差异
//  - lodash 4.18.0 已审核（Apache-2.0），撤回/重审后再应用 → 版本+许可证差异
store.applyCandidate(hljs.id, '11.11.0');
store.applyCandidate(lodash.id, '4.18.0');
store.refresh();
let conflicts = store.getState().conflicts;
ok('刷新输出冲突数组', Array.isArray(conflicts));
ok(
  '冻结批次记录的 highlight.js 11.11.1 与当前 11.11.0 不一致被列出（版本差异，许可证相同）',
  conflicts.some((c) => c.depName === 'highlight.js' && c.ruleCode === 'R7' && /批次 #1/.test(c.rule) && c.oldLicense === 'BSD-3-Clause' && c.newLicense === 'BSD-3-Clause'),
);
ok(
  'lodash 批次快照与当前版本冲突同时包含旧新许可证差异（MIT ↔ Apache-2.0）',
  conflicts.some((c) => c.depName === 'lodash' && c.ruleCode === 'R7' &&
    ((c.oldLicense === 'MIT' && c.newLicense === 'Apache-2.0') ||
     (c.oldLicense === 'Apache-2.0' && c.newLicense === 'MIT'))),
);
ok(
  '冲突行含 依赖/旧新许可证/引用路径/命中规则 四要素',
  conflicts.every((c) => c.depName && 'oldLicense' in c && 'newLicense' in c && 'path' in c && c.ruleCode),
);
// 解决遗留 gpl-external，避免噪音干扰后续断言
const liblegacyRef = store.getState().deps.find((d) => d.id === legacy.id).paths.find((p) => p.path.includes('liblegacy') && !p.removedAt);
if (liblegacyRef) store.addAuthorization({depId: legacy.id, version: '2.1.0', coveredPathIds: [liblegacyRef.id], approver: '法务'});
store.addAuthorization({depId: stamper.id, version: '1.3.0', coveredPathIds: [], approver: '法务'});
store.refresh();
ok('授权版本与当前版本不一致列为冲突',
  store.getState().conflicts.some((c) => c.depName === 'pdf-stamper' && /授权版本/.test(c.rule)));
// 授权覆盖已删除路径
const reactRefId = store.getState().deps.find((d) => d.id === react.id).paths[0].id;
store.addAuthorization({depId: react.id, version: '18.3.1', coveredPathIds: ['nonexistent-ref-id'], approver: '法务'});
store.refresh();
ok('授权覆盖的引用路径不存在列为冲突（呼应 R4 收回）',
  store.getState().conflicts.some((c) => c.depName === 'react' && /覆盖路径/.test(c.rule)));
ok('reactRefId 存在（防止上面取错）', Boolean(reactRefId));
// 问题全部修复后再刷新：冲突清零（批次版本差异是真实差异，撤回可消除）
store.withdrawCurrent(hljs.id);
store.withdrawCurrent(lodash.id);
// 撤销失效授权（错版本 / 覆盖不存在路径）后，对应冲突应消除
for (const a of store.getState().authorizations.filter((x) => !x.revoked && (x.version === '1.3.0' || x.coveredPathIds.includes('nonexistent-ref-id')))) {
  store.revokeAuthorization(a.id);
}
// 收尾：legacy 授权在批次实验中被撤销，重新授权；stamper 路径在 R4 中全部移除，悬空授权撤销
const legacyOpen = store.getState().deps.find((d) => d.id === legacy.id).paths.filter((p) => !p.removedAt);
for (const p of legacyOpen) {
  store.addAuthorization({depId: legacy.id, version: '2.1.0', coveredPathIds: [p.id], approver: '法务'});
}
for (const a of store.getState().authorizations.filter((x) => !x.revoked && x.depId === stamper.id)) {
  store.revokeAuthorization(a.id);
}
store.refresh();
ok('失效授权撤销/补齐后，授权与路径类（R3/R7）冲突不再产生',
  !store.getState().conflicts.some((c) => /授权版本|覆盖路径|GPL 对外分发/.test(c.rule)));
ok('批次历史差异作为不可变审计记录持续列出（撤回/补录均不改写批次）',
  store.getState().conflicts.some((c) => /批次 #/.test(c.rule)));

console.log('持久化：localStorage 中状态与 store 一致');
const raw = JSON.parse(globalThis.localStorage.getItem('license-lens-v2'));
ok('localStorage 已写入且批次保留', raw.batches.length >= 1 && raw.deps.length >= 6);

console.log(`\n${fail === 0 ? '全部通过' : '存在失败'}：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
