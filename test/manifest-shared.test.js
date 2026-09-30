import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { sharedManifestChecks } from '../shared/test/manifest-shared.js';

const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Writes a small extension to a temp dir and returns its root URL. */
function extension({ manifest = {}, background = 'export {};', version = '1.0.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ext-'));
  dirs.push(root);
  mkdirSync(join(root, 'src/icons'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(root, 'src/background.js'), background);
  writeFileSync(join(root, 'src/content.js'), '');
  writeFileSync(join(root, 'src/icons/icon-16.png'), '');
  writeFileSync(
    join(root, 'src/manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      version: '1.0.0',
      minimum_chrome_version: '116',
      description: 'Short.',
      background: { service_worker: 'background.js' },
      content_scripts: [{ matches: ['https://example.com/*'], js: ['content.js'] }],
      icons: { 16: 'icons/icon-16.png' },
      ...manifest,
    }),
  );
  return new URL(`${root}/`, 'file:///');
}

const run = (root, name) => {
  const check = sharedManifestChecks(root).find((c) => c.name === name);
  assert.ok(check, `no check named ${name}`);
  return check.run;
};

describe('sharedManifestChecks', () => {
  it('passes a well-formed extension', () => {
    const root = extension();
    for (const { run } of sharedManifestChecks(root)) run();
  });

  it('ties the manifest version to package.json', () => {
    assert.throws(run(extension({ version: '1.0.1' }), 'is Manifest V3 with the package version'), /1\.0\.1/);
  });

  it('tolerates content scripts without css and names missing files', () => {
    const ok = extension({ manifest: { content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }] } });
    run(ok, 'references only files that exist')();

    const bad = extension({
      manifest: { content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], css: ['nope.css'] }] },
    });
    assert.throws(run(bad, 'references only files that exist'), /missing nope\.css/);
  });

  it('checks optional pages when present', () => {
    const bad = extension({ manifest: { side_panel: { default_path: 'panel/panel.html' } } });
    assert.throws(run(bad, 'references only files that exist'), /missing panel\/panel\.html/);
  });

  it('caps the store description at 132 characters', () => {
    assert.throws(
      run(
        extension({ manifest: { description: 'x'.repeat(133) } }),
        'keeps the store description within 132 characters',
      ),
      /133/,
    );
  });

  it('fails an unguarded setAccessLevel call when Chrome 116 is still supported', () => {
    const name = 'guards setAccessLevel on Chrome versions that lack it';
    const unguarded = "chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });\n";
    assert.throws(run(extension({ background: `// sw\n${unguarded}` }), name), /background\.js:2/);

    run(
      extension({ background: `chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });` }),
      name,
    )();
    run(extension({ background: `if (chrome.storage.local.setAccessLevel) {\n  ${unguarded}}` }), name)();
    run(
      extension({ background: `if (typeof chrome.storage.local.setAccessLevel === 'function') ${unguarded}` }),
      name,
    )();
    run(extension({ background: unguarded, manifest: { minimum_chrome_version: '140' } }), name)();
    run(extension({ background: '' }), name)();
  });
});
