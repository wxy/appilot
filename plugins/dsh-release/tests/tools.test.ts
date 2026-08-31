import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGetReleaseDraftTool } from '../src/get-release-draft';
import { checkReleaseReadiness } from '../src/check-release-readiness';
import { syncReleaseStatus } from '../src/sync-release-status';
import { createGenerateStoreCopyTool } from '../src/generate-store-copy';
import { createReviseStoreCopyTool } from '../src/revise-store-copy';
import { memoryProjectStore } from '@appilot/dsh-common';

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

function basenameOf(p: string) {
  return p.split('/').pop() || p;
}

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'appilot-release-'));
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

  const draft = await callTool(createGetReleaseDraftTool(), { path: repo });
  assert.equal(draft.versionTag, 'v1.0.0');
  assert.equal(draft.latestTags[0].name, 'v1.0.0');
  assert.ok(typeof draft.head.sha === 'string' && draft.head.sha.length > 0);
  console.log('✅ PASS: get_release_draft returns latest tag + head info');

  const store = memoryProjectStore();
  const draftByName = createGetReleaseDraftTool(store);
  await store.save({
    name: basenameOf(repo),
    path: repo,
    githubUrl: 'https://github.com/wxy/appilot',
    platform: null,
    languages: [],
    lastResolvedAt: new Date().toISOString(),
  });
  const draftRef = await callTool(draftByName, { project: basenameOf(repo) });
  assert.equal(draftRef.versionTag, 'v1.0.0');
  console.log('✅ PASS: get_release_draft resolves by registered project name');

  await assert.rejects(
    () => callTool(draftByName, { project: 'nope' }),
    /未找到已注册项目/,
  );
  console.log('✅ PASS: get_release_draft rejects unknown project name');

  const readiness = await callTool(checkReleaseReadiness, { path: repo });
  assert.equal(readiness.versionTag, 'v1.0.0');
  assert.ok(Array.isArray(readiness.checks));
  for (const item of readiness.checks) {
    assert.ok(['pass', 'fail', 'warning', 'unknown'].includes(item.status));
  }
  console.log('✅ PASS: check_release_readiness returns checks array');

  const status = await callTool(syncReleaseStatus, { path: repo });
  assert.equal(status.latestTag.name, 'v1.0.0');
  assert.ok(Array.isArray(status.githubReleases));
  console.log('✅ PASS: sync_release_status returns latest tag + release list');

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

  console.log('\n🎉 All @appilot/dsh-release tool tests passed!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
