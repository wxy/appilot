/**
 * ai-provider 空内容重试决策单测（审计 M-2）：
 * 截断（length）只允许一次「加倍上限」的加价重试，防止同一请求反复计费。
 */
import assert from 'node:assert';
import { nextMaxTokensAfterEmpty } from '../packages/core/src/ai/ai-provider';

{
  // 首次截断：加倍上限
  assert.equal(nextMaxTokensAfterEmpty('length', 2000, false), 4000);
  assert.equal(nextMaxTokensAfterEmpty('length', 4000, true), null);
}

{
  // 已用过一次加价重试 → 放弃（null），不再第三次计费
  assert.equal(nextMaxTokensAfterEmpty('length', 8000, true), null);
}

{
  // 上限已达 64k → 放弃
  assert.equal(nextMaxTokensAfterEmpty('length', 64000, false), null);
}

{
  // 非截断类空内容：原参数重试
  assert.equal(nextMaxTokensAfterEmpty('stop', 2000, false), 2000);
  assert.equal(nextMaxTokensAfterEmpty(undefined, 2000, true), 2000);
}

console.log('🎉 All ai empty-retry tests passed!');
