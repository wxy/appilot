import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '@appilot/dsh-common';
import type { ProjectStore } from '@appilot/dsh-common';

/**
 * 列出已注册的项目（注册表内容）。
 */
export function createListProjectsTool(store: ProjectStore) {
  return defineTool({
    name: 'list_projects',
    description:
      'List projects registered in the Appilot project registry (name, path, GitHub URL, platform, languages, last resolved time).',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute() {
      const projects = await store.list();
      return jsonify({ count: projects.length, projects });
    },
  });
}
