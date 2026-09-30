import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { fakeChrome, installPage, settle } from './support.js';

/** The ids options.js needs, in a page with icon templates unless `icons` is false. */
const page = ({ icons = true, next = 'Open the panel to start.' } = {}) => `<!doctype html>
<body data-next="${next}">
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
afterEach(() => {
  restore();
  delete globalThis.fetch;
});

/** Loads options.js fresh against a page and a chrome double; `replies` feed the key check. */
async function load({ store = {}, replies = [], ...pageOptions } = {}) {
  const chrome = fakeChrome(store);
  restore = installPage(page(pageOptions), chrome);
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    const { status, body } = replies.shift();
    return new Response(JSON.stringify(body), { status });
  };
  await import(`../shared/src/options/options.js?case=${seq++}`);
  await settle();
  const $ = (id) => globalThis.document.getElementById(id);
  return { chrome, requests, $, document: globalThis.document, window: globalThis.window };
}

const okReply = { status: 200, body: { answers: { ok: { type: 'choice', choice: 'yes' } } } };

async function submit({ $, window }, key) {
  $('api-key').value = key;
  const pending = new Promise((resolve) => {
    $('key-form').addEventListener('submit', () => resolve(), { once: true });
  });
  $('key-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await pending;
  await settle();
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
    assert.equal($('api-key').getAttribute('aria-invalid'), 'true');
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

  it('treats a busy provider as a working key', async () => {
    const ctx = await load({ store: { apiKey: 'vck_abcdefghijklmnop1234' }, replies: [{ status: 429, body: {} }] });
    ctx.$('test').click();
    await settle();
    await settle();
    assert.equal(ctx.$('connected-status').textContent, 'Key works.');
    assert.equal(ctx.$('connected-status').dataset.tone, 'ok');
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
