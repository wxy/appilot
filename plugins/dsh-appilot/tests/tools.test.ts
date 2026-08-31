import assert from 'node:assert/strict';
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

const REPO = '/Users/xingyuwang/develop/appilot';

async function callTool(tool: any, args: unknown) {
  return tool.execute(args, execFor());
}

async function main() {
  // resolve_current_project
  const resolved = await callTool(resolveCurrentProject, { path: REPO });
  assert.equal(resolved.name, 'appilot');
  assert.equal(resolved.repo.githubUrl, 'https://github.com/wxy/appilot');
  assert.equal(typeof resolved.path, 'string');
  assert.equal(typeof resolved.repo.dirty, 'boolean');
  console.log('✅ PASS: resolve_current_project resolves repo + github url');

  const resolvedCwd = await callTool(resolveCurrentProject, {});
  assert.equal(typeof resolvedCwd.path, 'string');
  console.log('✅ PASS: resolve_current_project defaults to cwd');

  // get_project_context
  const context = await callTool(getProjectContext, { path: REPO });
  assert.ok(context.profile.name.length > 0);
  assert.ok(typeof context.promptBlock === 'string' && context.promptBlock.length > 0);
  console.log('✅ PASS: get_project_context builds profile + prompt block');

  // get_release_draft
  const draft = await callTool(getReleaseDraft, { path: REPO });
  assert.ok(Array.isArray(draft.latestTags));
  assert.ok('versionTag' in draft);
  assert.ok('sha' in draft.head || draft.head.sha === null);
  console.log('✅ PASS: get_release_draft returns versionTag + head info');

  // check_release_readiness
  const readiness = await callTool(checkReleaseReadiness, { path: REPO });
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
