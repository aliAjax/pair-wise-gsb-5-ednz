// 数据层：初始数据与「重新扫描」演示观测数据。不含判定规则。
import type { ComplianceState, Dep, DepSnapshot } from './types';

const snap = (
  version: string,
  license: string,
  copyright: string,
  source: string,
  usage: 'internal' | 'external' = 'external',
): DepSnapshot => ({ version, license, copyright, source, usage });

const mk = (
  id: number,
  name: string,
  current: DepSnapshot,
  refs: string[],
  rest: Partial<Dep> = {},
): Dep => ({
  id,
  name,
  current,
  candidate: null,
  review: null,
  refs: refs.map((path) => ({ path, count: 1 })),
  grants: [],
  approvedVersions: [],
  ...rest,
});

export const STORAGE_KEY = 'license-lens-compliance-v1';

export function initialState(): ComplianceState {
  const deps: Dep[] = [
    mk(
      1,
      'react',
      snap('18.3.1', 'MIT', 'Copyright (c) Meta Platforms, Inc.', 'npm'),
      ['src/main.tsx', 'src/App.tsx'],
      {
        approvedVersions: [
          { ...snap('18.2.0', 'MIT', 'Copyright (c) Meta Platforms, Inc.', 'npm'), approvedAt: '2026-01-12T02:00:00.000Z' },
        ],
      },
    ),
    mk(
      2,
      'lodash',
      snap('4.17.21', 'MIT', 'Copyright (c) OpenJS Foundation and contributors', 'npm'),
      ['src/utils/format.ts'],
    ),
    mk(
      3,
      'chart.js',
      snap('4.4.4', 'MIT', 'Copyright (c) Chart.js Contributors', 'npm'),
      ['src/components/Dashboard.tsx'],
    ),
    mk(
      4,
      'highlight.js',
      snap('11.10.0', 'BSD-3-Clause', 'Copyright (c) 2006, Ivan Sagalaev', 'npm'),
      ['src/components/CodeBlock.tsx'],
    ),
    mk(
      5,
      'legacy-parser',
      snap('2.1.0', 'GPL-3.0', 'Copyright (c) 2019 OldStack Ltd.', '手动', 'internal'),
      ['src/tools/importer.ts'],
    ),
    mk(
      6,
      'date-fns',
      snap('3.6.0', 'MIT', 'Copyright (c) 2021 Sasha Koss and Lesha Koss', 'npm'),
      ['src/utils/date.ts', 'src/components/Header.tsx'],
    ),
  ];
  return { deps, batches: [], seq: 0 };
}

/** 「重新扫描」观测结果：演示许可证 / 版权 / 来源 / 使用范围 / 引用路径变化 */
export const scanFixture = [
  {
    name: 'react',
    version: '19.1.0',
    license: 'MIT',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates',
    source: 'npm',
    usage: 'external' as const,
    refs: ['src/main.tsx', 'src/App.tsx'],
  },
  {
    name: 'lodash',
    version: '4.17.21',
    license: 'MIT',
    copyright: 'Copyright (c) OpenJS Foundation and contributors',
    source: 'npm',
    usage: 'external' as const,
    refs: ['src/utils/format.ts', 'src/utils/table.ts'], // 新增引用路径
  },
  {
    name: 'chart.js',
    version: '4.5.0',
    license: 'Apache-2.0', // 许可证变化
    copyright: 'Copyright (c) Chart.js Contributors',
    source: 'npm',
    usage: 'external' as const,
    refs: ['src/components/Dashboard.tsx'],
  },
  {
    name: 'highlight.js',
    version: '11.11.1',
    license: 'BSD-3-Clause',
    copyright: 'Copyright (c) 2006-2026, Ivan Sagalaev and contributors', // 版权声明变化
    source: 'npm',
    usage: 'external' as const,
    refs: ['src/components/CodeBlock.tsx'],
  },
  {
    name: 'legacy-parser',
    version: '2.2.0',
    license: 'GPL-3.0',
    copyright: 'Copyright (c) 2019 OldStack Ltd.',
    source: '私有镜像', // 来源变化
    usage: 'external' as const, // 内部使用 → 对外分发，须授权覆盖路径
    refs: ['src/tools/importer.ts', 'src/tools/exporter.ts'],
  },
  {
    name: 'date-fns',
    version: '3.6.0',
    license: 'MIT',
    copyright: 'Copyright (c) 2021 Sasha Koss and Lesha Koss',
    source: 'npm',
    usage: 'external' as const,
    refs: ['src/utils/date.ts'], // Header.tsx 引用已移除（唯一引用，义务收回）
  },
];
