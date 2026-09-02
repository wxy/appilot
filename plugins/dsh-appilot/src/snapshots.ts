/**
 * appilot_snapshots 工具：只读共享 DB 的排名快照历史（Phase 4b 后半）。
 *
 * - mode=latest：每个 (keyword, language, storefront) 的最新一条；
 * - mode=history：时间序列点（降序），可按 productId（Electron 产品维度）与 keyword 过滤。
 *
 * 读的是共享 SQLite（openSharedHeadlessStore）——DSH 采集写入的行
 * （productId=null）与 Electron 双写的行（productId=<product>）都能读；
 * 未配置凭据也能看到已采集过的历史。只读、不触发任何采集。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, openSharedHeadlessStore } from '@appilot-labs/appilot-common';

/** appilot_snapshots：查询共享 DB 的排名快照（latest / history 两种视图）。 */
export function createSnapshotsQueryTool() {
  return defineTool({
    name: 'appilot_snapshots',
    description:
      'Query Appilot rank snapshots from the shared SQLite database (read-only, no collection triggered). ' +
      'mode=latest returns the newest snapshot per (keyword, language, storefront); ' +
      'mode=history returns recent points in time-descending order. ' +
      'productId filters to an Electron product dimension (empty/omitted = DSH-collected rows where productId is null).',
    parameters: {
      projectName: {
        type: 'string',
        required: true,
        description: 'Registered project name (the folder basename used at registration).',
      },
      mode: {
        type: 'string',
        enum: ['latest', 'history'] as const,
        description: 'latest = 每关键词最新一条；history = 时间序列（默认 latest）。',
      },
      productId: {
        type: 'string',
        description:
          'Optional Electron product id (e.g. "proj-id:macos"). Empty/omitted = DSH-dimension rows (productId null).',
      },
      keyword: {
        type: 'string',
        description: 'Optional filter: only snapshots for this keyword (history mode).',
      },
      limit: {
        type: 'number',
        description: 'Max points to return in history mode (default 100, max 2000).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(params: any) {
      const store = openSharedHeadlessStore();
      const projectName = String(params?.projectName ?? '');
      const productId = params?.productId ? String(params.productId) : null;
      if (!projectName) return jsonify({ error: 'projectName 必填' });
      if (params?.mode === 'history') {
        const limit = Number.isFinite(Number(params?.limit)) ? Number(params.limit) : 100;
        const rows = store.snapshots.recent(projectName, {
          productId,
          keyword: params?.keyword ? String(params.keyword) : undefined,
          limit,
        });
        return jsonify({ projectName, productId, mode: 'history', count: rows.length, snapshots: rows });
      }
      const rows = store.snapshots.latestByKey(projectName, productId);
      return jsonify({ projectName, productId, mode: 'latest', count: rows.length, snapshots: rows });
    },
  });
}
