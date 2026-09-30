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

  it('only accepts setAccessLevel inside a try block when Chrome 116 is still supported', () => {
    const name = 'guards setAccessLevel on Chrome versions that lack it';
    const call = "chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });\n";
    const optional = "chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });\n";

    // Bare call, and the guards that look safe but are not: on 116-139 the method exists and throws.
    assert.throws(run(extension({ background: `// sw\n${call}` }), name), /background\.js:2/);
    assert.throws(run(extension({ background: `// sw\n// note\n${optional}` }), name), /background\.js:3/);
    assert.throws(run(extension({ background: `if (chrome.storage.local.setAccessLevel) {\n  ${call}}` }), name), /:2/);
    assert.throws(
      run(extension({ background: `if (typeof chrome.storage.local.setAccessLevel === 'function') ${call}` }), name),
    );

    // A try block is the only thing that stops a synchronous throw from killing the worker.
    run(extension({ background: `try {\n  ${call}} catch {\n  // Chrome < 140\n}\n` }), name)();
    run(extension({ background: `try {\n  ${optional}} catch (error) {\n  console.debug(error);\n}\n` }), name)();
    run(extension({ background: `try {\n  ${call}} finally {\n  setup();\n}\n` }), name)();
    // A try block elsewhere does not cover a call outside it.
    assert.throws(run(extension({ background: `try {\n  setup();\n} catch {}\n${call}` }), name), /:4/);

    run(extension({ background: call, manifest: { minimum_chrome_version: '140' } }), name)();
    run(extension({ background: '' }), name)();
  });
});
