/**
 * 共享项目注册表（方案 A：单一事实源文件 + 双向同步）。
 *
 * 文件：`<userData>/registry.json`（Electron 与 DSH 插件共用；DSH 侧按 OS 约定
 * 推导同一路径，可用环境变量 APPILOT_REGISTRY_FILE 覆盖/重定向）。
 *
 * 一致性模型（诚实说明）：无锁双写下不可能强一致；本实现保证——
 * - 原子写（tmp + rename）：并发写不损坏文件；
 * - 按记录 `updatedAt` 合并（后写者赢）：并发写收敛；
 * - 每次读取都从磁盘现读：对方（Electron）的写入被直接看到（无需 watch）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectRecord, ProjectStore } from './storage.js';

/** 注册表记录 = ProjectRecord + 合并时间戳。 */
export interface RegistryRecord extends ProjectRecord {
  updatedAt: string;
}

export const REGISTRY_VERSION = 1;

/** 默认共享注册表路径（与 Electron userData 一致；env 可覆盖）。 */
export function defaultRegistryPath(): string {
  const env = process.env.APPILOT_REGISTRY_FILE;
  if (env) return env;
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Appilot', 'registry.json');
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    return join(base, 'Appilot', 'registry.json');
  }
  const base = process.env.XDG_CONFIG_HOME || join(home, '.config');
  return join(base, 'Appilot', 'registry.json');
}

/** 读取注册表（按 name 索引）；文件缺失/损坏 → 空表。 */
export async function readRegistry(
  filePath: string,
): Promise<Record<string, RegistryRecord>> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) return {};
    const out: Record<string, RegistryRecord> = {};
    for (const p of data.projects) {
      if (p && typeof p.name === 'string' && typeof p.path === 'string') {
        out[p.name] = p as RegistryRecord;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 原子写注册表（进程内串行化：read-merge-write 竞态导致丢失更新的情况被消除）。 */
let writeChain: Promise<unknown> = Promise.resolve();

async function doWrite(
  filePath: string,
  records: Record<string, RegistryRecord>,
): Promise<void> {
  const payload = JSON.stringify(
    { version: REGISTRY_VERSION, projects: Object.values(records) },
    null,
    2,
  );
  await mkdir(dirname(filePath), { recursive: true });
  // tmp 名用 uuid 保证唯一：跨进程同毫秒并发写也不会互相覆盖导致 rename ENOENT。
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, payload, 'utf8');
  await rename(tmp, filePath);
}

export function writeRegistry(
  filePath: string,
  records: Record<string, RegistryRecord>,
): Promise<void> {
  return mutateRegistry(filePath, () => records);
}

/**
 * 在进程内串行化的「读-合并-写」区段里执行变更：
 * 消除 read-merge-write 竞态导致的丢失更新（并发 save 全量保留）。
 */
export function mutateRegistry(
  filePath: string,
  fn: (current: Record<string, RegistryRecord>) => Record<string, RegistryRecord>,
): Promise<void> {
  const run = writeChain.then(async () => {
    const current = await readRegistry(filePath);
    const next = fn(current);
    await doWrite(filePath, next);
  });
  writeChain = run.catch(() => {});
  return run;
}

/** 按 updatedAt 合并（后写者赢；时间相同取 incoming）。 */
export function mergeRegistry(
  current: Record<string, RegistryRecord>,
  incoming: Record<string, RegistryRecord>,
): Record<string, RegistryRecord> {
  const out = { ...current };
  for (const [key, rec] of Object.entries(incoming)) {
    const existing = out[key];
    const recTime = new Date(rec.updatedAt || 0).getTime();
    const curTime = existing ? new Date(existing.updatedAt || 0).getTime() : 0;
    if (!existing || recTime >= curTime) out[key] = rec;
  }
  return out;
}

/** 基于共享注册表文件的 ProjectStore 实现。 */
export function fileProjectStore(filePath: string): ProjectStore {
  const strip = ({ updatedAt: _u, ...rec }: RegistryRecord): ProjectRecord => rec;
  return {
    async save(record) {
      await mutateRegistry(filePath, (current) =>
        mergeRegistry(current, {
          [record.name]: { ...record, updatedAt: new Date().toISOString() },
        }),
      );
    },
    async list() {
      const records = await readRegistry(filePath);
      return Object.values(records).map(strip);
    },
    async get(name) {
      const records = await readRegistry(filePath);
      const rec = records[name];
      return rec ? strip(rec) : undefined;
    },
  };
}
