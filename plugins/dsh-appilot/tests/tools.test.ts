import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCurrentProject } from '../src/tools/resolve-current-project';
import { getProjectContext } from '../src/tools/get-project-context';
import { getReleaseDraft } from '../src/tools/get-release-draft';
import { checkReleaseReadiness } from '../src/tools/check-release-readiness';

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
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(),
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

  console.log('\n🎉 All @appilot/dsh tool tests passed!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
