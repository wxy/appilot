/**
 * 截图图片「已知路径」白名单单测（审计 2026-09-26 M-M4）。
 * 纯 node，不 import electron。
 */
import assert from 'node:assert/strict';
import {
  isKnownImagePath,
  KNOWN_SCREENSHOT_IMAGE_PATHS_CAP,
  rememberKnownImagePath,
} from '../src/main/screenshot-paths';

const A = '/tmp/shots/a.png';
const B = '/tmp/shots/b.png';
const C = '/tmp/shots/c.png';

// 登记与校验
let list = rememberKnownImagePath([], A);
assert.deepEqual(list, [A], '登记后集合包含该路径');
assert.equal(isKnownImagePath(list, A), true, '已知路径放行');

// resolve 归一：相对/尾缀形态不得绕过，也不得误判
assert.equal(isKnownImagePath(list, '  ' + A + ' '), true, '首尾空白归一后仍放行');
assert.equal(isKnownImagePath(list, '/tmp/shots/../shots/a.png'), true, '.. 归一后仍放行');
assert.equal(isKnownImagePath(list, '/tmp/shots/a.png.bak'), false, '后缀拼接不放行');

// 未登记路径拒绝（含目录穿越形态）
assert.equal(isKnownImagePath(list, '/etc/passwd'), false, '任意路径拒绝');
assert.equal(isKnownImagePath(list, ''), false, '空路径拒绝');
assert.equal(isKnownImagePath(list, undefined as unknown as string), false, '非字符串拒绝');

// 去重置顶 + 容量截断
list = rememberKnownImagePath(list, B);
list = rememberKnownImagePath(list, A); // 重复登记 → 置顶去重
assert.deepEqual(list, [A, B], '重复登记去重并置顶');
list = rememberKnownImagePath(list, C);
assert.deepEqual(list, [C, A, B], '新路径置顶');
assert.ok(KNOWN_SCREENSHOT_IMAGE_PATHS_CAP >= 1, '容量上限为正数');
let big: string[] = [];
for (let i = 0; i < KNOWN_SCREENSHOT_IMAGE_PATHS_CAP + 50; i += 1) {
  big = rememberKnownImagePath(big, `/tmp/shots/gen-${i}.png`);
}
assert.equal(big.length, KNOWN_SCREENSHOT_IMAGE_PATHS_CAP, '集合不超过容量上限');

console.log('screenshot-paths 单测全部通过 ✓');
