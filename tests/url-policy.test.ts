import assert from 'node:assert/strict';
import { isAllowedAiProviderUrl, isAllowedAppStorePage, isAllowedRendererNavigation, safeHttpUrl } from '../src/main/url-policy';

assert.equal(safeHttpUrl('https://github.com/wxy/appilot')?.protocol, 'https:');
assert.equal(safeHttpUrl('http://localhost:5173')?.protocol, 'http:');
assert.equal(safeHttpUrl('javascript:alert(1)'), null);
assert.equal(safeHttpUrl('file:///etc/passwd'), null);
assert.equal(safeHttpUrl('https://example.com', { httpsOnly: true })?.hostname, 'example.com');
assert.equal(safeHttpUrl('http://example.com', { httpsOnly: true }), null);

assert.equal(isAllowedAppStorePage('https://apps.apple.com/us/app/id123'), true);
assert.equal(isAllowedAppStorePage('https://itunes.apple.com/us/app/id123'), true);
assert.equal(isAllowedAppStorePage('https://apps.apple.com.evil.example/id123'), false);
assert.equal(isAllowedAppStorePage('https://example.com'), false);

// AI 供应商端点白名单（M-M2）：https 放行；http 仅本机回环；其余拒绝。
assert.equal(isAllowedAiProviderUrl('https://api.deepseek.com'), true);
assert.equal(isAllowedAiProviderUrl('http://localhost:11434/v1'), true);
assert.equal(isAllowedAiProviderUrl('http://127.0.0.1:8080/v1'), true);
assert.equal(isAllowedAiProviderUrl('http://[::1]:11434/v1'), true);
assert.equal(isAllowedAiProviderUrl('http://api.example.com'), false);
assert.equal(isAllowedAiProviderUrl('ftp://example.com'), false);
assert.equal(isAllowedAiProviderUrl('not a url'), false);
assert.equal(isAllowedAiProviderUrl(''), false);
assert.equal(isAllowedAiProviderUrl(undefined), false);

// file: 导航白名单（M-M5）：只放行应用 renderer 目录前缀；缺省全拒绝。
const rendererDir = '/app/out/renderer';
assert.equal(isAllowedRendererNavigation('file:///app/out/renderer/index.html', undefined, rendererDir), true);
assert.equal(
  isAllowedRendererNavigation('file:///app/out/renderer/assets/x.html', undefined, rendererDir),
  true,
);
assert.equal(isAllowedRendererNavigation('file:///etc/passwd', undefined, rendererDir), false);
assert.equal(
  isAllowedRendererNavigation('file:///app/out/../out/secret.html', undefined, rendererDir),
  false,
  '.. 归一后越出前缀 → 拒绝',
);
assert.equal(isAllowedRendererNavigation('file:///etc/passwd'), false, '未提供前缀 → file 全拒绝');
assert.equal(
  isAllowedRendererNavigation('file://evil.example/etc/passwd', undefined, rendererDir),
  false,
  '带 host 的 file URL → 拒绝',
);
assert.equal(
  isAllowedRendererNavigation('http://localhost:5173/projects', 'http://localhost:5173'),
  true,
);
assert.equal(
  isAllowedRendererNavigation('https://example.com', 'http://localhost:5173'),
  false,
);

console.log('url-policy 单测全部通过 ✓');
