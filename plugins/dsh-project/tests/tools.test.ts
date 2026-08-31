import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCurrentProject } from '../src/resolve-current-project';
import { getProjectContext } from '../src/get-project-context';
import { createRegisterProjectTool } from '../src/register-project';
import { createListProjectsTool } from '../src/list-projects';
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
  const dir = mkdtempSync(join(tmpdir(), 'appilot-project-'));
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

  const resolved = await callTool(resolveCurrentProject, { path: repo });
  assert.equal(typeof resolved.path, 'string');
  assert.equal(typeof resolved.name, 'string');
  assert.equal(resolved.repo.githubUrl, 'https://github.com/wxy/appilot');
  assert.equal(typeof resolved.repo.dirty, 'boolean');
  console.log('✅ PASS: resolve_current_project resolves fixture repo + github url');

  const resolvedCwd = await callTool(resolveCurrentProject, {});
  assert.equal(typeof resolvedCwd.path, 'string');
  console.log('✅ PASS: resolve_current_project defaults to cwd');

  const context = await callTool(getProjectContext, { path: repo });
  assert.ok(context.profile.name.length > 0);
  assert.ok(typeof context.promptBlock === 'string' && context.promptBlock.length > 0);
  console.log('✅ PASS: get_project_context builds profile + prompt block');

  const store = memoryProjectStore();
  const registered = await callTool(createRegisterProjectTool(store), { path: repo });
  assert.equal(registered.registered, true);
  assert.equal(registered.record.name, basenameOf(repo));
  console.log('✅ PASS: register_project saves a project record');

  const listed = await callTool(createListProjectsTool(store), {});
  assert.equal(listed.count, 1);
  assert.equal(listed.projects[0].name, basenameOf(repo));
  console.log('✅ PASS: list_projects returns the registered project');

  console.log('\n🎉 All @appilot/dsh-project tool tests passed!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
