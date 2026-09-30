import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createSource, parseShared, pinCommit, run } from '../scripts/sync-shared.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
const template = readFileSync(join(repo, 'templates/SHARED.md'), 'utf8');

const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A consumer repo in a temp dir with a SHARED.md listing two upstream files. */
function consumer({ commit = head, copy = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'consumer-'));
  dirs.push(root);
  const files = [
    ['shared/src/lib/jev.js', 'src/lib/jev.js'],
    ['shared/test/helpers.js', 'test/helpers.js'],
  ];
  const rows = files.map(([from, to]) => `| \`${from}\` | \`${to}\` | |`).join('\n');
  writeFileSync(
    join(root, 'SHARED.md'),
    `# Shared files\n\n- Upstream: https://github.com/dgr8akki/jev-shared\n- Commit: \`${commit}\`\n\n| Upstream path | Local path | Note |\n| --- | --- | --- |\n${rows}\n`,
  );
  if (copy) {
    for (const [from, to] of files) {
      mkdirSync(dirname(join(root, to)), { recursive: true });
      writeFileSync(join(root, to), execFileSync('git', ['-C', repo, 'show', `${head}:${from}`]));
    }
  }
  return root;
}

const io = (root, env = {}) => {
  const lines = [];
  return { lines, options: { root, env, log: (line) => lines.push(line) } };
};

describe('parseShared', () => {
  it('reads the template that consumers paste', () => {
    const parsed = parseShared(template);
    assert.equal(parsed.upstream, 'https://github.com/dgr8akki/jev-shared');
    assert.equal(parsed.commit, '0'.repeat(40));
    assert.deepEqual(parsed.files[0], { from: 'shared/src/lib/jev.js', to: 'src/lib/jev.js', note: '' });
    assert.ok(parsed.files.some((f) => f.from === 'scripts/sync-shared.js' && f.to === 'scripts/sync-shared.js'));
    assert.match(parsed.files.find((f) => f.to === 'src/lib/connection.js').note, /primaryClass/);
  });

  it('survives prettier re-aligning the table and a missing commit', () => {
    const text =
      '- Upstream: <https://github.com/o/r.git>\n- Commit: `TODO`\n\n|Upstream path|Local path|\n|-|-|\n|   a/b.js   |c/b.js|\n';
    const parsed = parseShared(text);
    assert.equal(parsed.upstream, 'https://github.com/o/r.git');
    assert.equal(parsed.commit, null);
    assert.deepEqual(parsed.files, [{ from: 'a/b.js', to: 'c/b.js', note: '' }]);
  });

  it('rejects a manifest without an upstream or files', () => {
    assert.throws(() => parseShared('# nothing'), /Upstream/);
    assert.throws(() => parseShared('- Upstream: https://github.com/o/r\n'), /lists no files/);
  });
});

describe('pinCommit', () => {
  it('replaces only the sha', () => {
    const sha = 'a'.repeat(40);
    const pinned = pinCommit(template, sha);
    assert.equal(parseShared(pinned).commit, sha);
    assert.equal(pinned.replace(sha, '0'.repeat(40)), template);
    assert.equal(parseShared(pinCommit(pinned, 'b'.repeat(40))).commit, 'b'.repeat(40));
  });
});

describe('run --check', () => {
  it('passes when every copy matches the pinned commit', async () => {
    const root = consumer();
    const { lines, options } = io(root, { JEV_SHARED_DIR: repo });
    assert.equal(await run(['--check'], options), 0);
    assert.equal(lines.at(-1), `2 shared files match https://github.com/dgr8akki/jev-shared @ ${head.slice(0, 7)}.`);
  });

  it('fails and names a file that was edited locally', async () => {
    const root = consumer();
    writeFileSync(join(root, 'src/lib/jev.js'), '// local tweak\n', { flag: 'a' });
    const { lines, options } = io(root);
    assert.equal(await run(['--check', '--from', repo], options), 1);
    assert.ok(
      lines.some((l) => l === 'drift: src/lib/jev.js differs from shared/src/lib/jev.js'),
      lines.join('\n'),
    );
    assert.ok(!lines.some((l) => l.includes('helpers.js')), 'untouched file not reported');
  });

  it('fails and names a file that is missing', async () => {
    const root = consumer();
    rmSync(join(root, 'test/helpers.js'));
    const { lines, options } = io(root, { JEV_SHARED_DIR: repo });
    assert.equal(await run(['--check'], options), 1);
    assert.ok(lines.includes('drift: test/helpers.js is missing'), lines.join('\n'));
  });

  it('refuses to check against no pinned commit', async () => {
    const root = consumer({ commit: 'TODO' });
    await assert.rejects(run(['--check'], io(root, { JEV_SHARED_DIR: repo }).options), /pins no commit/);
    await assert.rejects(run(['--check', 'main'], io(root).options), /takes no ref/);
  });
});

describe('run <ref>', () => {
  it('copies every listed file from the ref and pins its commit', async () => {
    const root = consumer({ commit: 'TODO', copy: false });
    const { lines, options } = io(root);
    assert.equal(await run(['HEAD', '--from', repo], options), 0);
    // Compare with the committed file, not the working tree, so an uncommitted edit here does not fail this test.
    assert.equal(
      readFileSync(join(root, 'src/lib/jev.js'), 'utf8'),
      execFileSync('git', ['-C', repo, 'show', `${head}:shared/src/lib/jev.js`]).toString(),
    );
    assert.equal(parseShared(readFileSync(join(root, 'SHARED.md'), 'utf8')).commit, head);
    assert.ok(lines.includes(`pinned SHARED.md to ${head.slice(0, 7)}`));
    assert.equal(await run(['--check'], { ...options, env: { JEV_SHARED_DIR: repo } }), 0);
  });

  it('restores edited copies at the pinned commit when given no ref', async () => {
    const root = consumer();
    writeFileSync(join(root, 'test/helpers.js'), 'broken');
    assert.equal(await run([], io(root, { JEV_SHARED_DIR: repo }).options), 0);
    assert.equal(await run(['--check'], io(root, { JEV_SHARED_DIR: repo }).options), 0);
  });

  it('explains a missing SHARED.md and unknown options', async () => {
    const root = mkdtempSync(join(tmpdir(), 'empty-'));
    dirs.push(root);
    await assert.rejects(run([], io(root).options), /No SHARED\.md in/);
    await assert.rejects(run(['--nope'], io(root).options), /Unknown option --nope/);
  });
});

describe('createSource over GitHub', () => {
  const upstream = 'https://github.com/dgr8akki/jev-shared';
  const fetchImpl = async (url, init) => {
    fetchImpl.calls.push({ url, init });
    if (url.startsWith('https://api.github.com/repos/dgr8akki/jev-shared/commits/main'))
      return new Response(`${head}\n`);
    if (url === `https://raw.githubusercontent.com/dgr8akki/jev-shared/${head}/shared/src/lib/jev.js`) {
      return new Response('bytes');
    }
    return new Response('nope', { status: 404 });
  };
  fetchImpl.calls = [];

  it('resolves refs through the API and reads raw files at a commit', async () => {
    const source = createSource({ upstream, fetchImpl });
    assert.equal(await source.resolve(head), head, 'a sha needs no request');
    assert.equal(await source.resolve('main'), head);
    assert.equal(fetchImpl.calls.at(-1).init.headers.Accept, 'application/vnd.github.sha');
    assert.equal((await source.read(head, 'shared/src/lib/jev.js')).toString(), 'bytes');
    await assert.rejects(source.read(head, 'missing.js'), /HTTP 404/);
    assert.throws(() => createSource({ upstream: 'https://github.com/', fetchImpl }), /owner\/repo/);
  });
});

describe('createSource with a token (private upstream)', () => {
  const upstream = 'https://github.com/dgr8akki/jev-shared';
  /** Records requests; answers the contents API, the commits API and raw files. */
  function github() {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, headers: init.headers ?? {} });
      if (url.startsWith('https://api.github.com/repos/dgr8akki/jev-shared/commits/main'))
        return new Response(`${head}\n`);
      if (url === `https://api.github.com/repos/dgr8akki/jev-shared/contents/shared/src/lib/jev.js?ref=${head}`) {
        return new Response('api bytes');
      }
      if (url === `https://raw.githubusercontent.com/dgr8akki/jev-shared/${head}/shared/src/lib/jev.js`) {
        return new Response('raw bytes');
      }
      return new Response('nope', { status: 404 });
    };
    return { calls, fetchImpl };
  }

  it('reads through the contents API with a bearer token and the raw media type', async () => {
    const { calls, fetchImpl } = github();
    const source = createSource({ upstream, fetchImpl, token: 'tok' });
    assert.equal((await source.read(head, 'shared/src/lib/jev.js')).toString(), 'api bytes');
    assert.equal(calls.at(-1).headers.Authorization, 'Bearer tok');
    assert.equal(calls.at(-1).headers.Accept, 'application/vnd.github.raw+json');
    assert.equal(await source.resolve('main'), head);
    assert.equal(calls.at(-1).headers.Authorization, 'Bearer tok');
  });

  it('stays on raw.githubusercontent.com with no Authorization header when there is no token', async () => {
    const { calls, fetchImpl } = github();
    const source = createSource({ upstream, fetchImpl });
    assert.equal((await source.read(head, 'shared/src/lib/jev.js')).toString(), 'raw bytes');
    assert.equal(calls.at(-1).headers.Authorization, undefined);
    await source.resolve('main');
    assert.equal(calls.at(-1).headers.Authorization, undefined);
  });

  it('hints at JEV_SHARED_TOKEN on a 404 without a token, and not with one', async () => {
    const { fetchImpl } = github();
    await assert.rejects(createSource({ upstream, fetchImpl }).read(head, 'missing.js'), (error) => {
      assert.match(error.message, /HTTP 404/);
      assert.match(error.message, /private.*JEV_SHARED_TOKEN/i);
      return true;
    });
    await assert.rejects(createSource({ upstream, fetchImpl, token: 'tok' }).read(head, 'missing.js'), (error) => {
      assert.match(error.message, /HTTP 404/);
      assert.doesNotMatch(error.message, /JEV_SHARED_TOKEN/);
      return true;
    });
  });

  it('run() takes the token from JEV_SHARED_TOKEN, then GITHUB_TOKEN', async () => {
    for (const [env, expected] of [
      [{ JEV_SHARED_TOKEN: 'a', GITHUB_TOKEN: 'b' }, 'Bearer a'],
      [{ GITHUB_TOKEN: 'b' }, 'Bearer b'],
      [{}, undefined],
    ]) {
      const root = consumer({ copy: true });
      const calls = [];
      const fetchImpl = async (url, init = {}) => {
        calls.push(init.headers ?? {});
        const path = url.includes('/contents/') ? url.split('/contents/')[1].split('?')[0] : url.split(`${head}/`)[1];
        return new Response(execFileSync('git', ['-C', repo, 'show', `${head}:${path}`]));
      };
      const { options } = io(root, env);
      assert.equal(await run(['--check'], { ...options, fetchImpl }), 0, JSON.stringify(env));
      assert.equal(calls.length, 2);
      assert.ok(
        calls.every((h) => h.Authorization === expected),
        `${JSON.stringify(env)} -> ${JSON.stringify(calls)}`,
      );
    }
  });
});
