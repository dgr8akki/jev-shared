import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { fakeChrome, installPage, settle } from './support.js';

/** The ids options.js needs, in a page with icon templates unless `icons` is false. */
const page = ({ icons = true, next = 'Open the panel to start.', app = 'Test App' } = {}) => `<!doctype html>
<head><title>Fixture settings</title></head>
<body data-next="${next}"${app ? ` data-app="${app}"` : ''}>
  <p id="kicker"></p>
  <section id="connected" hidden>
    <span id="provider-label"></span><code id="masked"></code>
    <button id="test" type="button">Test</button>
    <button id="replace" type="button">Replace</button>
    <button id="remove" type="button">Remove</button>
    <p id="connected-status" role="status"></p>
  </section>
  <form id="key-form" novalidate hidden>
    <input type="radio" name="provider" value="vercel" />
    <input type="radio" name="provider" value="typesafe" />
    <ol id="steps"></ol>
    <input id="api-key" type="password" />
    <button type="submit">Connect</button>
    <button id="cancel" type="button" hidden>Cancel</button>
    <p id="key-status" role="status"></p>
  </form>
  <code id="host"></code>
  ${
    icons
      ? `<template data-icon="busy"><span class="spinner"></span></template>
  <template data-icon="ok"><svg class="i-ok"></svg></template>
  <template data-icon="error"><svg class="i-error"></svg></template>
  <template data-icon="neutral"><svg class="i-neutral"></svg></template>`
      : ''
  }
</body>`;

let restore = () => {};
let seq = 0;
const logged = [];
const consoleError = console.error;
afterEach(() => {
  restore();
  delete globalThis.fetch;
  console.error = consoleError;
  logged.length = 0;
});

/** Loads options.js fresh against a page and a chrome double; `replies` feed the key check. */
async function load({ store = {}, replies = [], ...pageOptions } = {}) {
  const chrome = fakeChrome(store);
  restore = installPage(page(pageOptions), chrome);
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (reply.raw) return reply.raw;
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
  console.error = (...args) => logged.push(args);
  await import(`../shared/src/options/options.js?case=${seq++}`);
  await settle();
  const $ = (id) => globalThis.document.getElementById(id);
  return { chrome, requests, $, document: globalThis.document, window: globalThis.window };
}

const okReply = { status: 200, body: { answers: { ok: { type: 'choice', choice: 'yes' } } } };

/** Submits the form and waits until the check has finished (the Connect button is enabled again). */
async function submit({ $, window }, key) {
  $('api-key').value = key;
  const button = $('key-form').querySelector('button[type="submit"]');
  $('key-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  // A 5xx makes the real client pause 400 ms before its retry, so poll rather than count ticks.
  const deadline = Date.now() + 3_000;
  do await settle();
  while (button.disabled && Date.now() < deadline);
  assert.equal(button.disabled, false, 'the key check never finished');
  await settle();
}

describe('options page', () => {
  it('opens on the form when no key is saved', async () => {
    const { $, document } = await load();
    assert.equal($('key-form').hidden, false);
    assert.equal($('connected').hidden, true);
    assert.equal($('cancel').hidden, true);
    assert.equal($('kicker').textContent, 'Welcome');
    assert.equal(document.body.dataset.state, 'welcome');
    assert.equal($('host').textContent, 'ai-gateway.vercel.sh');
    assert.equal($('steps').children.length, 3);
    assert.match($('steps').innerHTML, /opens in a new tab/);
    assert.equal(document.activeElement, $('api-key'));
  });

  it('shows the connected card for a saved key', async () => {
    const { $, document } = await load({ store: { apiKey: 'vck_abcdefghijklmnop1234', provider: 'typesafe' } });
    assert.equal($('key-form').hidden, true);
    assert.equal($('connected').hidden, false);
    assert.equal($('provider-label').textContent, 'TypeSafe');
    assert.equal($('masked').textContent, 'vck_…1234');
    assert.equal($('kicker').textContent, 'Settings');
    assert.equal(document.body.dataset.state, 'connected');
  });

  it('does nothing with an empty key', async () => {
    const ctx = await load();
    await submit(ctx, '   ');
    assert.equal(ctx.requests.length, 0);
    assert.equal(ctx.$('key-status').textContent, '');
  });

  it('checks the key with the provider, saves it and reads the next step from the page', async () => {
    const ctx = await load({ replies: [okReply], next: 'Reload LinkedIn to see labels.' });
    const { $, chrome, requests } = ctx;
    await submit(ctx, ' vck_abcdefghijklmnop1234 ');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer vck_abcdefghijklmnop1234');
    assert.deepEqual(chrome.store, { apiKey: 'vck_abcdefghijklmnop1234', provider: 'vercel' });
    assert.equal($('connected').hidden, false);
    assert.equal($('connected-status').dataset.tone, 'ok');
    assert.equal($('connected-status').textContent, 'Key works. Reload LinkedIn to see labels.');
    assert.ok($('connected-status').querySelector('.i-ok'), 'ok icon cloned from its template');
    assert.equal($('api-key').value, '', 'key never left in the input');
  });

  it('refuses a key when the provider answers 200 with nothing useful', async () => {
    const ctx = await load({ replies: [{ status: 200, body: {} }] });
    const { $, chrome } = ctx;
    await submit(ctx, 'vck_abcdefghijklmnop1234');
    assert.deepEqual(chrome.store, {});
    assert.equal($('key-form').hidden, false);
    assert.equal($('key-status').dataset.tone, 'error');
    assert.match($('key-status').textContent, /Unexpected reply/);
    assert.ok($('key-status').querySelector('.i-error'));
  });

  it("shows a rejected key in the provider's words and clears the error on typing", async () => {
    const ctx = await load({ replies: [{ status: 401, body: {} }] });
    const { $, window } = ctx;
    await submit(ctx, 'vck_abcdefghijklmnop1234');
    assert.match($('key-status').textContent, /key was rejected/);
    $('api-key').dispatchEvent(new window.Event('input'));
    assert.equal($('api-key').getAttribute('aria-invalid'), 'false');
    assert.equal($('key-status').textContent, '');
    assert.equal($('key-status').dataset.tone, undefined);
  });

  it('locks the input and marks the button busy while checking', async () => {
    let release;
    const ctx = await load();
    const { $, window } = ctx;
    globalThis.fetch = () =>
      new Promise((resolve) => {
        release = () => resolve(new Response(JSON.stringify(okReply.body), { status: 200 }));
      });
    $('api-key').value = 'vck_abcdefghijklmnop1234';
    $('key-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
    const button = $('key-form').querySelector('button[type="submit"]');
    assert.equal($('api-key').readOnly, true);
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.ok(button.querySelector('.spinner'), 'busy icon in the button');
    assert.equal($('key-status').dataset.tone, 'busy');
    release();
    await settle();
    await settle();
    assert.equal($('api-key').readOnly, false);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Connect');
  });

  it('says "Key works." the same way from Connect and Test, adding the next step only on Connect', async () => {
    const ctx = await load({ replies: [okReply, okReply], next: 'Reload LinkedIn to see labels.' });
    await submit(ctx, 'vck_abcdefghijklmnop1234');
    assert.equal(ctx.$('connected-status').textContent, 'Key works. Reload LinkedIn to see labels.');
    ctx.$('test').click();
    await settle();
    await settle();
    assert.equal(ctx.$('connected-status').textContent, 'Key works.');
    assert.equal(ctx.$('connected-status').dataset.tone, 'ok');
  });

  it('refuses a 200 whose answer is not a choice, keeping the key out of storage', async () => {
    const noPick = { status: 200, body: { answers: { ok: { type: 'choice', probabilities: { yes: 0.5 } } } } };
    const ctx = await load({ replies: [noPick] });
    await submit(ctx, 'vck_abcdefghijklmnop1234');
    assert.deepEqual(ctx.chrome.store, {});
    assert.equal(ctx.$('key-status').textContent, 'Unexpected reply from ai-gateway.vercel.sh.');
    assert.equal(ctx.$('key-status').dataset.tone, 'error');
    assert.equal(ctx.$('api-key').getAttribute('aria-invalid'), 'false', "a garbled reply is not the key's fault");
  });

  it('saves the key on a 429 and says the provider is busy, in a neutral tone', async () => {
    const busy = { status: 429, body: {} };
    const ctx = await load({ replies: [busy, busy] });
    await submit(ctx, 'vck_abcdefghijklmnop1234');
    assert.deepEqual(ctx.chrome.store, { apiKey: 'vck_abcdefghijklmnop1234', provider: 'vercel' });
    assert.equal(ctx.$('connected-status').textContent, 'Key accepted; the provider is busy right now.');
    assert.equal(ctx.$('connected-status').dataset.tone, 'neutral');
    ctx.$('test').click();
    await settle();
    await settle();
    assert.equal(ctx.$('connected-status').textContent, 'Key accepted; the provider is busy right now.');
    assert.equal(ctx.$('connected-status').dataset.tone, 'neutral');
  });

  it('marks the input invalid only when the provider rejected the key', async () => {
    const cases = [
      [{ status: 401, body: {} }, 'true', /key was rejected/],
      [{ status: 403, body: { error: { message: 'Add a credit card to use AI Gateway.' } } }, 'true', /credit card/],
      [new TypeError('Failed to fetch'), 'false', /Can't reach ai-gateway\.vercel\.sh/],
      [{ status: 503, body: {} }, 'false', /HTTP 503/],
      [{ status: 402, body: {} }, 'false', /budget is used up/],
    ];
    for (const [reply, invalid, message] of cases) {
      const ctx = await load({ replies: [reply, reply] });
      await submit(ctx, 'vck_abcdefghijklmnop1234');
      assert.deepEqual(ctx.chrome.store, {}, `${message} saved a key`);
      assert.match(ctx.$('key-status').textContent, message);
      assert.equal(ctx.$('api-key').getAttribute('aria-invalid'), invalid, `aria-invalid for ${message}`);
      restore();
    }
  });

  it("logs a failure that is not the provider's under the app name and keeps the key out of storage", async () => {
    // A reply without .json() breaks the client itself, which is our bug, not a provider verdict.
    const ctx = await load({ replies: [{ raw: { status: 200, ok: true, headers: new Headers() } }] });
    await submit(ctx, 'vck_abcdefghijklmnop1234');
    assert.deepEqual(ctx.chrome.store, {});
    assert.equal(ctx.$('key-status').textContent, 'Something went wrong while checking the key. Try again.');
    assert.equal(ctx.$('api-key').getAttribute('aria-invalid'), 'false');
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], 'Test App: key check failed');
    assert.ok(logged[0][1] instanceof TypeError);
    restore();

    const untitled = await load({ replies: [{ raw: { status: 200, ok: true, headers: new Headers() } }], app: '' });
    await submit(untitled, 'vck_abcdefghijklmnop1234');
    assert.equal(logged[1][0], 'Fixture settings: key check failed', 'falls back to the page title');
  });

  it('moves focus to Test after Connect, to Replace after Cancel and to the key field after Remove', async () => {
    const ctx = await load({ replies: [okReply] });
    const { $, document } = ctx;
    await submit(ctx, 'vck_abcdefghijklmnop1234');
    assert.equal(document.activeElement, $('test'), 'after Connect');
    $('replace').click();
    assert.equal(document.activeElement, $('api-key'), 'while replacing');
    $('cancel').click();
    assert.equal(document.activeElement, $('replace'), 'after Cancel');
    $('remove').click();
    await settle();
    assert.equal(document.activeElement, $('api-key'), 'after Remove');
  });

  it('puts focus back in the key field after a failed check, not on body', async () => {
    const failures = [
      { status: 200, body: {} },
      { status: 401, body: {} },
      new TypeError('Failed to fetch'),
      { raw: { status: 200, ok: true, headers: new Headers() } },
    ];
    for (const reply of failures) {
      const ctx = await load({ replies: [reply] });
      const { $, window, document } = ctx;
      $('api-key').value = 'vck_abcdefghijklmnop1234';
      $('key-form').querySelector('button[type="submit"]').focus();
      $('key-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      // The handler disables the focused Connect button before it awaits the provider. Chrome drops focus to
      // body at that moment; jsdom leaves it on the disabled button (and ignores blur() there). Either way
      // the page must bring it back to the field once the failure shows.
      const deadline = Date.now() + 3_000;
      do await settle();
      while ($('key-form').querySelector('button[type="submit"]').disabled && Date.now() < deadline);
      assert.equal($('key-form').hidden, false);
      assert.equal(document.activeElement.id, 'api-key', `after ${reply.status ?? reply.message}`);
      restore();
    }
  });

  it('works without icon templates, leaving the tone for CSS', async () => {
    const ctx = await load({ replies: [okReply], icons: false });
    await submit(ctx, 'vck_abcdefghijklmnop1234');
    const status = ctx.$('connected-status');
    assert.equal(status.dataset.tone, 'ok');
    assert.equal(status.children.length, 1, 'only the text span');
    assert.equal(status.textContent, 'Key works. Open the panel to start.');
  });

  it('replaces, cancels and removes', async () => {
    const { $, chrome, document } = await load({ store: { apiKey: 'vck_abcdefghijklmnop1234' } });
    $('replace').click();
    assert.equal($('key-form').hidden, false);
    assert.equal($('cancel').hidden, false);
    assert.equal($('kicker').textContent, 'Replace your key');
    assert.equal(document.body.dataset.state, 'replace');
    $('cancel').click();
    assert.equal($('key-form').hidden, true);
    $('remove').click();
    await settle();
    assert.deepEqual(chrome.store, {});
    assert.equal($('key-form').hidden, false);
    assert.equal($('key-status').dataset.tone, 'neutral');
    assert.match($('key-status').textContent, /removed/);
  });
});
