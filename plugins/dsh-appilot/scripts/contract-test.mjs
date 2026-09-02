/**
 * 契约校验：appilot_overview 工具输出 ↔ 客户端 OverviewDsh 映射读取的字段。
 * 跑法：node scripts/contract-test.mjs（需先 npm run build:core / build 出 dist）。
 * null 视为合法（客户端映射全部 null 兜底）；仅当「key 缺失」才判失败。
 */
import { createAppilotOverviewTool } from '../dist/overview.js';

const tool = createAppilotOverviewTool(async () => null);
const get = (out, p) => { let o = out; for (const k of p.split('.')) { if (o == null) return undefined; o = o[k]; } return o; };

function check(out, label, present, nullable) {
  const fail = [];
  for (const c of present) if (get(out, c) === undefined) fail.push(c + ' 缺 key');
  for (const c of nullable) if (get(out, c) === undefined) fail.push(c + ' 缺 key(null 可)');
  console.log(`  ${label}: ${fail.length === 0 ? 'OK' : '问题 ' + JSON.stringify(fail)}`);
  return fail.length === 0;
}

const results = [];
// 1) 真实仓库（remote/tags/commits；无商店链接 → store/rank 为 null 合法）
const real = await tool.execute({ path: '/Users/xingyuwang/develop/appilot' });
results.push(check(real, '真实仓库(appilot)', [
  'path', 'name', 'languages', 'repo.remoteUrl', 'repo.githubUrl', 'repo.branch',
  'repo.headSha', 'repo.dirty', 'release.recentTags', 'release.readiness.checks',
  'activity.commits', 'activity.releases', 'skipped',
], ['release.latestTag', 'store', 'rank', 'asc', 'brief']));

// 2) fixture（README 商店链接 → store/rank 形状）
const fx = await tool.execute({ path: '/tmp/ap-fixture', keywords: ['notion', 'notes'] });
results.push(check(fx, 'fixture(商店+排名)', [
  'store.trackId', 'rank.keywords', 'rank.snapshots', 'activity.commits',
], [
  // lookup 依赖，可瞬时为 null（客户端有兜底）
  'store.metadata', 'store.currentVersion', 'release.latestTag', 'repo.remoteUrl', 'asc', 'brief',
]));
// 若 store.metadata 非 null，其叶子字段必须在（形状校验）
const meta = fx.store?.metadata;
if (meta) {
  for (const f of ['trackName', 'bundleId', 'artworkUrl', 'version']) {
    if (!(f in meta)) results.push(false), console.log('  缺 store.metadata.' + f);
  }
}

const snap = fx.rank?.snapshots?.[0];
const snapOk = !!snap && ['keyword', 'language', 'storefront', 'rank', 'totalResults', 'checkedAt'].every((f) => f in snap);
console.log('  snapshot 形状:', snapOk ? 'OK' : 'BROKEN');

const commits = real.activity?.commits || {};
const commitOk = Object.keys(commits).length > 0 && Object.values(commits).every((n) => typeof n === 'number');
console.log('  commits Record<date,count>:', commitOk ? 'OK' : 'BROKEN', `(${Object.keys(commits).length} 天)`);

const allOk = results.every(Boolean) && snapOk && commitOk;
console.log(allOk ? '\nCONTRACT ALL OK' : '\nCONTRACT BROKEN');
process.exit(allOk ? 0 : 1);
