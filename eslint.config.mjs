// ESLint 平面配置（审计 2026-09-26 E3）：
// 仓库此前没有任何 lint 工具链，只有 tsc strict——react-hooks 违规
// （条件 return 之后调用 hooks，见审计 H6）正是缺口的直接后果。
//
// 基线策略：react-hooks 规则为 error（防 H6 类地雷再次进入）；其余既有
// 代码的存量问题（no-explicit-any 等）以 warn 起步，逐步清零后再收紧。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'dist-electron/**',
      'packages/*/dist/**',
      'plugins/*/dist/**',
      // 提交进仓库的 esbuild 产物
      'plugins/dsh-appilot/client/**',
      // 本地会话记忆（gitignored，不入库）
      '.remember/**',
      '**/*.d.ts',
    ],
  },
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 打包器场景外的 CJS 入口（bin 脚本、tailwind 配置）合法使用 require
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 存量基线：warn 起步（见文件头注释），不阻塞 CI
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': 'warn',
      // 主进程/调度器里大量刻意的惰性 require（electron 规避、测试注入）
      '@typescript-eslint/no-require-imports': 'off',
      // 文件名清洗正则刻意匹配控制字符（\u0000-\u001F）
      'no-control-regex': 'warn',
    },
  },
);
