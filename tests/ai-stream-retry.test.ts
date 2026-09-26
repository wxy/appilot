/**
 * ai-provider 流式重试内容隔离单测（审计 2026-09-26 H1）：
 * 第 1 个流尝试半途失败（网络断开等）后，已收到的半截文本/finish_reason/
 * usage 不得残留或与下一个成功尝试的完整输出拼接——最终结果必须只含成功
 * 尝试的内容。旧实现 content 跨尝试累积，产出「半截+全文」的损坏文案。
 * 纯 node（不 import electron），通过注入假 OpenAI client 驱动。
 */
import assert from 'node:assert';
import { AIProvider } from '../packages/core/src/ai/ai-provider';

function chunk(delta: unknown, finish?: string, usage?: any) {
  return {
    choices: [{ delta, finish_reason: finish ?? null }],
    ...(usage ? { usage } : {}),
  };
}

/** 可编程假流：依次 yield chunks；failAfterN = 抛错前最多吐出 N 个 chunk。 */
function makeStream(chunks: any[], failAfterN?: number) {
  let i = 0;
  return {
    async *[Symbol.asyncIterator]() {
      while (i < chunks.length) {
        if (failAfterN !== undefined && i >= failAfterN) {
          throw new Error('connection reset during stream');
        }
        yield chunks[i];
        i += 1;
      }
    },
  };
}

async function main() {
  const provider = new AIProvider({
    baseURL: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
  });
  const calls: any[] = [];
  const finishReasons: (string | undefined)[] = [];
  (provider as any).client = {
    chat: {
      completions: {
        create: async (req: any) => {
          calls.push(req);
          if (calls.length === 1) {
            // 尝试 1：吐出半截文本后连接中断（无 finish_reason、无 usage）
            return makeStream(
              [chunk({ content: 'HALF-' }), chunk({ content: 'BROKEN' })],
              1,
            );
          }
          // 尝试 2：完整输出（含 reasoning 增量、finish_reason、usage）
          return makeStream([
            chunk({ reasoning_content: 'thinking…' }),
            chunk({ content: 'FULL' }),
            chunk({ content: '-TEXT' }, 'stop', { prompt_tokens: 5, total_tokens: 9 }),
          ]);
        },
      },
    },
  };

  const out = await provider.chat(
    [{ role: 'user', content: 'hi' }],
    // 传 onProgress 才会走流式分支（与真实调用一致）
    { onProgress: () => {}, onFinishReason: (r) => finishReasons.push(r) },
  );

  assert.equal(calls.length, 2, '应有两次流式尝试（首试失败后重试）');
  assert.equal(
    out,
    'FULL-TEXT',
    `最终内容必须只含成功尝试的完整输出（实际 ${JSON.stringify(out)}）`,
  );
  assert.equal(finishReasons.at(-1), 'stop', 'finish_reason 应来自成功尝试');
  assert.equal(
    provider.totalUsage?.totalTokens,
    9,
    `usage 只计成功尝试（实际 ${JSON.stringify(provider.totalUsage)}）`,
  );
  console.log('🎉 ai-stream-retry tests passed!');
}

main().catch((err) => {
  console.error('ai-stream-retry 测试失败:', err);
  process.exit(1);
});
