import { resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '@appilot/dsh-common';
import { resolveProjectRecord, type ProjectStore } from '@appilot/dsh-common';

/**
 * 注册/更新一个项目到持久化存储，之后其他工具可按项目名引用（无需每次给路径）。
 */
export function createRegisterProjectTool(store: ProjectStore) {
  return defineTool({
    name: 'register_project',
    description:
      'Register (or refresh) a repository path in the Appilot project registry. After registration, other Appilot tools can reference the project by name instead of an absolute path. Persists in the Harness storage (web profile) or in-memory for the session.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path of the project directory.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args) {
      const path = resolvePath(args.path);
      const record = await resolveProjectRecord(path);
      await store.save(record);
      return jsonify({ registered: true, record });
    },
  });
}
