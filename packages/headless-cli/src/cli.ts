#!/usr/bin/env node
/**
 * Appilot headless CLI — 直接对接 headless 服务 API（无需任何壳）。
 *
 * 用法：
 *   appilot-headless db                         打印共享数据库路径
 *   appilot-headless projects list
 *   appilot-headless projects get <name>
 *   appilot-headless projects register <path> [--name <name>]
 *   appilot-headless projects remove <name>
 *   appilot-headless snapshots latest <project> [--product <id>]
 *   appilot-headless tasks list
 *   appilot-headless run <taskId>               立即运行共享任务（release-sync / readiness）
 *
 * DB 路径：默认 defaultDbPath()（与 Electron/DSH 共享同一 appilot.db），
 * 环境变量 APPILOT_DB_FILE 覆盖（测试/隔离用）。输出一律 JSON（stdout），
 * 错误信息写 stderr 并以非零码退出——适合脚本与 AI agent 消费。
 */
import { basename, resolve } from 'node:path';
import {
  buildHeadlessExecutors,
  buildHeadlessJobs,
  createHeadlessService,
  createLeaseScheduler,
  defaultDbPath,
  githubSyncInstancesFor,
  openStore,
  reconcileTaskInstances,
  type ProjectRow,
} from '@appilot-labs/appilot-headless';

function envToken(name: string): Promise<string | null> {
  return Promise.resolve(process.env[name] ?? null);
}

function parseArgs(argv: string[]): { flags: Map<string, string>; pos: string[] } {
  const flags = new Map<string, string>();
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      flags.set(key, val !== undefined && !val.startsWith('--') ? val : '');
      if (val !== undefined && !val.startsWith('--')) i++;
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

function usage(): never {
  process.stderr.write(
    [
      'Appilot headless CLI — 共享 SQLite 数据与调度（无壳）',
      '',
      '用法:',
      '  appilot-headless db',
      '  appilot-headless projects list',
      '  appilot-headless projects get <name>',
      '  appilot-headless projects register <path> [--name <name>]',
      '  appilot-headless projects remove <name>',
      '  appilot-headless projects products <name>   # 产品注册（富数据，M3）',
      '  appilot-headless projects meta <name>       # repo 状态（富数据，M3）',
      '  appilot-headless projects release-cache <name>  # 发布页缓存（M4）',
      '  appilot-headless snapshots latest <project> [--product <id>]',
      '  appilot-headless snapshots history <project> [--product <id>] [--keyword <kw>] [--limit <n>]',
      '  appilot-headless snapshots prune <project> [--before <iso>]   # 默认清 90 天前',
      '  appilot-headless tasks list [--source dsh|electron|cli]',
      '  appilot-headless lease status        # 当前租约主（多壳调度验证）',
      '  appilot-headless run <taskId>   # release-sync | readiness',
      '',
      '环境变量 APPILOT_DB_FILE 覆盖数据库路径。输出 JSON。',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const store = openStore(process.env.APPILOT_DB_FILE || defaultDbPath());
  const svc = createHeadlessService(store);
  try {
    switch (cmd) {
      case 'db': {
        process.stdout.write(JSON.stringify({ dbPath: store.path }, null, 2) + '\n');
        return;
      }
      case 'projects': {
        const sub = argv[1];
        const { flags, pos } = parseArgs(argv.slice(2));
        switch (sub) {
          case 'list': {
            process.stdout.write(JSON.stringify({ projects: svc.projects.list() }, null, 2) + '\n');
            return;
          }
          case 'get': {
            const name = pos[0];
            if (!name) return usage();
            const p = svc.projects.get(name);
            if (!p) {
              process.stderr.write(`项目未注册: ${name}\n`);
              process.exitCode = 1;
              return;
            }
            process.stdout.write(JSON.stringify(p, null, 2) + '\n');
            return;
          }
          case 'register': {
            const rawPath = pos[0];
            if (!rawPath) return usage();
            const path = resolve(rawPath);
            const name = flags.get('name') || basename(path);
            const now = new Date().toISOString();
            const row: Omit<ProjectRow, 'updatedAt'> = {
              name,
              path,
              githubUrl: null,
              platform: null,
              languages: [],
              lastResolvedAt: now,
              artworkUrl: null,
            };
            svc.projects.register(row);
            const saved = svc.projects.get(name);
            process.stdout.write(JSON.stringify({ registered: saved }, null, 2) + '\n');
            return;
          }
          case 'remove': {
            const name = pos[0];
            if (!name) return usage();
            const removed = svc.projects.remove(name);
            process.stdout.write(JSON.stringify({ removed, name }, null, 2) + '\n');
            if (!removed) process.exitCode = 1;
            return;
          }
          case 'products': {
            const name = pos[0];
            if (!name) return usage();
            const products = svc.products.listByProject(name);
            process.stdout.write(
              JSON.stringify(
                {
                  project: name,
                  count: products.length,
                  products: products.map((pr) => ({
                    productId: pr.productId,
                    platform: pr.platform,
                    trackId: pr.trackId,
                    bundleId: pr.bundleId,
                    trackName: pr.trackName,
                    artworkUrl: pr.artworkUrl,
                    supportedLanguages: pr.supportedLanguages,
                    trackedKeywords: pr.trackedKeywords,
                  })),
                },
                null,
                2,
              ) + '\n',
            );
            return;
          }
          case 'meta': {
            const name = pos[0];
            if (!name) return usage();
            const meta = svc.meta.get(name);
            process.stdout.write(JSON.stringify({ project: name, meta: meta ?? null }, null, 2) + '\n');
            return;
          }
          case 'release-cache': {
            const name = pos[0];
            if (!name) return usage();
            const row = svc.releaseCache.get(name);
            if (!row) {
              process.stderr.write(`该项目暂无发布缓存: ${name}\n`);
              process.exitCode = 1;
              return;
            }
            process.stdout.write(
              JSON.stringify(
                {
                  project: name,
                  syncedAt: row.syncedAt,
                  tag: (row.cache as any)?.tag ?? null,
                  lastSeenSha: (row.cache as any)?.lastSeenSha ?? null,
                  pullRequests: ((row.cache as any)?.pullRequests ?? []).length,
                  releases: ((row.cache as any)?.releases ?? []).length,
                  repoCapabilities: (row.cache as any)?.repoCapabilities ?? null,
                },
                null,
                2,
              ) + '\n',
            );
            return;
          }
          default:
            return usage();
        }
      }
      case 'snapshots': {
        const sub = argv[1];
        const { flags, pos } = parseArgs(argv.slice(2));
        if (sub === 'latest') {
          const project = pos[0];
          if (!project) return usage();
          const product = flags.has('product') && flags.get('product') !== '' ? flags.get('product') : undefined;
          const rows = svc.snapshots.latest(project, product ?? null);
          process.stdout.write(JSON.stringify({ project, productId: product ?? null, snapshots: rows }, null, 2) + '\n');
          return;
        }
        if (sub === 'history') {
          const project = pos[0];
          if (!project) return usage();
          const product = flags.has('product') && flags.get('product') !== '' ? flags.get('product') : undefined;
          const keyword = flags.has('keyword') && flags.get('keyword') !== '' ? flags.get('keyword') : undefined;
          const limit = flags.has('limit') && flags.get('limit') !== '' ? Number(flags.get('limit')) : undefined;
          const rows = svc.snapshots.recent(project, {
            productId: product ?? null,
            keyword,
            limit: Number.isFinite(limit as number) ? (limit as number) : undefined,
          });
          process.stdout.write(
            JSON.stringify({ project, productId: product ?? null, keyword: keyword ?? null, count: rows.length, snapshots: rows }, null, 2) + '\n',
          );
          return;
        }
        if (sub === 'prune') {
          const project = pos[0];
          if (!project) return usage();
          // 默认清理 90 天前的快照（与 core RANK_SNAPSHOT_WINDOW_MS 一致）
          const before = flags.get('before') || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
          const removed = svc.snapshots.prune(project, before);
          process.stdout.write(JSON.stringify({ project, beforeIso: before, removed }, null, 2) + '\n');
          return;
        }
        return usage();
      }
      case 'tasks': {
        const sub = argv[1];
        const { flags } = parseArgs(argv.slice(2));
        if (sub === 'list' || sub === undefined) {
          const jobs = buildHeadlessJobs({ readToken: envToken });
          const definitions = jobs.map((j) => ({ id: j.id, title: j.title, intervalMinutes: j.intervalMinutes }));
          const source = flags.has('source') && flags.get('source') !== '' ? flags.get('source') : undefined;
          const tasks = source ? svc.tasks.listBySource(source as string) : svc.tasks.list();
          process.stdout.write(JSON.stringify({ tasks, definitions, source: source ?? null }, null, 2) + '\n');
          return;
        }
        return usage();
      }
      case 'lease': {
        const sub = argv[1];
        if (sub === 'status' || sub === undefined) {
          const info = store.lease.info();
          if (!info) {
            process.stdout.write(JSON.stringify({ leader: null, heartbeatAt: null, ageMs: null }, null, 2) + '\n');
            return;
          }
          process.stdout.write(
            JSON.stringify(
              {
                leader: info.leaderId,
                heartbeatAt: info.heartbeatAt,
                ageMs: Date.now() - new Date(info.heartbeatAt).getTime(),
              },
              null,
              2,
            ) + '\n',
          );
          return;
        }
        return usage();
      }
      case 'run': {
        const id = argv[1];
        if (!id) return usage();
        const scheduler = createLeaseScheduler({
          store,
          leaderId: `cli-${process.pid}`,
          jobs: buildHeadlessJobs({ readToken: envToken }),
          executors: buildHeadlessExecutors({ readToken: envToken }),
          heartbeatMs: 60_000,
        });
        try {
          // 实例任务（github-sync:<project>）：DB 无该行时按注册项目现场 seed（source=cli）
          if (!store.tasks.get(id) && id.startsWith('github-sync:')) {
            const name = id.slice('github-sync:'.length);
            const projects = store.projects
              .list()
              .filter((p) => p.name === name)
              .map((p) => ({ name: p.name, path: p.path }));
            reconcileTaskInstances(store, githubSyncInstancesFor(projects), 'cli');
          }
          const result = await scheduler.runNow(id);
          if (!result) {
            process.stderr.write(`未知任务: ${id}（可用: release-sync / readiness / github-sync:<项目名>）\n`);
            process.exitCode = 1;
            return;
          }
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } finally {
          scheduler.dispose();
        }
        return;
      }
      default:
        return usage();
    }
  } finally {
    store.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err: any) => {
    process.stderr.write(`错误: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
