import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCurrentProject } from '../src/tools/resolve-current-project';
import { getProjectContext } from '../src/tools/get-project-context';
import { getReleaseDraft } from '../src/tools/get-release-draft';
import { checkReleaseReadiness } from '../src/tools/check-release-readiness';
import { syncReleaseStatus } from '../src/tools/sync-release-status';
import { createGenerateStoreCopyTool } from '../src/tools/generate-store-copy';
import { createReviseStoreCopyTool } from '../src/tools/revise-store-copy';
import { createRegisterProjectTool } from '../src/tools/register-project';
import { createListProjectsTool } from '../src/tools/list-projects';
import { createGetReleaseDraftTool } from '../src/tools/get-release-draft';
import { memoryProjectStore } from '../src/storage';

/** 最小的 exec 环境（工具未使用 exec 的额外字段）。 */
function execFor() {
  return {
    callId: 'test-call',
    name: 'test',
    arguments: {},
    token: 'test-token',
    agent: { inject: async () => {} },
    signal: new AbortController().signal,
  } as any;
}

function basenameOf(p: string) {
  return p.split('/').pop() || p;
}

async function callTool(tool: any, args: unknown) {
  return tool.execute(args, execFor());
}

/** 在临时目录造一个带已知 remote + tag 的 git 仓库，测试完全确定、跨平台。 */
function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'appilot-fixture-'));
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git(['init', '-q']);
  git(['remote', 'add', 'origin', 'https://github.com/wxy/appilot.git']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  writeFileSync(join(dir, 'README.md'), '# Demo App\n\nA fixture repository.\n');
  git(['add', '.']);
  git(['commit', '-qm', 'init']);
  git(['tag', 'v1.0.0']);
  return dir;
}

async function main() {
  const repo = makeFixtureRepo();

  // resolve_current_project
  const resolved = await callTool(resolveCurrentProject, { path: repo });
  assert.equal(typeof resolved.path, 'string');
  assert.equal(typeof resolved.name, 'string');
  assert.equal(resolved.repo.githubUrl, 'https://github.com/wxy/appilot');
  assert.equal(typeof resolved.repo.dirty, 'boolean');
  assert.equal(
    resolved.repo.headSha,
    execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo })
      .toString()
      .trim(),
  );
  console.log('✅ PASS: resolve_current_project resolves fixture repo + github url');

  const resolvedCwd = await callTool(resolveCurrentProject, {});
  assert.equal(typeof resolvedCwd.path, 'string');
  console.log('✅ PASS: resolve_current_project defaults to cwd');

  // get_project_context
  const context = await callTool(getProjectContext, { path: repo });
  assert.ok(context.profile.name.length > 0);
  assert.ok(typeof context.promptBlock === 'string' && context.promptBlock.length > 0);
  console.log('✅ PASS: get_project_context builds profile + prompt block');

  // get_release_draft
  const draft = await callTool(getReleaseDraft, { path: repo });
  assert.equal(draft.versionTag, 'v1.0.0');
  assert.equal(draft.latestTags[0].name, 'v1.0.0');
  assert.ok(typeof draft.head.sha === 'string' && draft.head.sha.length > 0);
  console.log('✅ PASS: get_release_draft returns latest tag + head info');

  // check_release_readiness
  const readiness = await callTool(checkReleaseReadiness, { path: repo });
  assert.equal(readiness.versionTag, 'v1.0.0');
  assert.ok(Array.isArray(readiness.checks));
  for (const item of readiness.checks) {
    assert.ok(['pass', 'fail', 'warning', 'unknown'].includes(item.status));
  }
  console.log('✅ PASS: check_release_readiness returns checks array');

  // sync_release_status（无 GitHub remote 时只回本地 tag）
  const status = await callTool(syncReleaseStatus, { path: repo });
  assert.equal(status.latestTag.name, 'v1.0.0');
  assert.ok(Array.isArray(status.githubReleases));
  console.log('✅ PASS: sync_release_status returns latest tag + release list');

  // generate/revise 缺少 AI 凭据时必须报错（不泄漏密钥、不发起请求）
  await assert.rejects(
    () => callTool(createGenerateStoreCopyTool(), { path: repo, language: 'en' }),
    /APILOT_AI_BASE_URL/,
  );
  console.log('✅ PASS: generate_store_copy fails cleanly without credentials');
  await assert.rejects(
    () =>
      callTool(createReviseStoreCopyTool(), {
        path: repo,
        language: 'en',
        existingName: 'App',
        existingDescription: 'desc',
        reviewFeedback: 'keep brand name',
      }),
    /APILOT_AI_BASE_URL/,
  );
  console.log('✅ PASS: revise_store_copy fails cleanly without credentials');

  // 存储闭环：register → list → 按名引用（内存 store）
  const store = memoryProjectStore();
  const registerTool = createRegisterProjectTool(store);
  const listTool = createListProjectsTool(store);
  const draftByName = createGetReleaseDraftTool(store);
  const registered = await callTool(registerTool, { path: repo });
  assert.equal(registered.registered, true);
  assert.equal(registered.record.name, basenameOf(repo));
  console.log('✅ PASS: register_project saves a project record');

  const listed = await callTool(listTool, {});
  assert.equal(listed.count, 1);
  assert.equal(listed.projects[0].name, basenameOf(repo));
  console.log('✅ PASS: list_projects returns the registered project');

  const draftRef = await callTool(draftByName, { project: basenameOf(repo) });
  assert.equal(draftRef.versionTag, 'v1.0.0');
  console.log('✅ PASS: get_release_draft resolves by registered project name');

  await assert.rejects(
    () => callTool(draftByName, { project: 'nope' }),
    /未找到已注册项目/,
  );
  console.log('✅ PASS: get_release_draft rejects unknown project name');

  console.log('\n🎉 All @appilot/dsh tool tests passed!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
