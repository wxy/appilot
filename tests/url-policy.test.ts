import assert from 'node:assert/strict';
import { isAllowedAppStorePage, isAllowedRendererNavigation, safeHttpUrl } from '../src/main/url-policy';

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

assert.equal(isAllowedRendererNavigation('file:///app/out/renderer/index.html'), true);
assert.equal(
  isAllowedRendererNavigation('http://localhost:5173/projects', 'http://localhost:5173'),
  true,
);
assert.equal(
  isAllowedRendererNavigation('https://example.com', 'http://localhost:5173'),
  false,
);

console.log('url-policy 单测全部通过 ✓');
