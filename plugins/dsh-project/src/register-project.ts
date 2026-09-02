import { resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '@appilot-labs/appilot-common';
import { resolveProjectRecord, type ProjectStore } from '@appilot-labs/appilot-common';

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
      // App Store 适配性识别：未检测到 Apple 平台（iOS/macOS）时给出警告——
      // 这类项目不适合 App Store 运营（本阶段暂不支持其运营功能）。
      const warning =
        !record.platform
          ? '未检测到 Apple 平台（iOS/macOS）——该项目可能不适合 App Store 运营，本阶段暂不支持其运营功能。'
          : undefined;
      return jsonify({
        registered: true,
        record,
        ...(warning ? { warning } : {}),
      });
    },
  });
}
