import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { getConnection, mountConnection } from '../shared/src/lib/connection.js';
import { fakeChrome, installPage, settle } from './support.js';

const HTML = '<p id="text"></p><button id="button" class="btn">x</button>';
let restore = () => {};
afterEach(() => restore());

function mount(store, options) {
  const chrome = fakeChrome(store);
  restore = installPage(HTML, chrome);
  const text = globalThis.document.getElementById('text');
  const button = globalThis.document.getElementById('button');
  return { chrome, text, button, mounted: mountConnection(text, button, options) };
}

describe('getConnection', () => {
  it('falls back to the default provider for unknown values', async () => {
    restore = installPage(HTML, fakeChrome({ apiKey: 'k', provider: 'nope' }));
    assert.deepEqual(await getConnection(), { apiKey: 'k', provider: 'vercel' });
  });
});

describe('mountConnection', () => {
  it('asks for a key when none is saved', async () => {
    const changes = [];
    const { text, button, mounted } = mount({}, { onChange: (connected) => changes.push(connected) });
    assert.equal(await mounted, false);
    assert.equal(text.textContent, 'Connect a TypeSafe or Vercel AI Gateway key to start.');
    assert.equal(button.textContent, 'Connect Jev');
    assert.deepEqual([...button.classList], ['btn', 'btn-primary']);
    assert.deepEqual(changes, [false]);
  });

  it("shows the provider and masked key, keeping the button's other classes", async () => {
    const { text, button, mounted } = mount({ apiKey: 'vck_abcdefghijklmnop1234', provider: 'typesafe' });
    assert.equal(await mounted, true);
    assert.equal(text.textContent, 'Connected via TypeSafevck_…1234');
    assert.equal(text.querySelector('.mono').textContent, 'vck_…1234');
    assert.equal(button.textContent, 'Change');
    assert.deepEqual([...button.classList], ['btn', 'btn-secondary']);
  });

  it('uses the class names the page passes in', async () => {
    const { chrome, button, mounted } = mount({}, { primaryClass: 'primary', secondaryClass: 'ghost' });
    await mounted;
    assert.deepEqual([...button.classList], ['btn', 'primary']);
    await chrome.storage.local.set({ apiKey: 'vck_abcdefghijklmnop1234' });
    await settle();
    assert.deepEqual([...button.classList], ['btn', 'ghost']);
  });

  it('works with no options at all', async () => {
    const { mounted } = mount({});
    assert.equal(await mounted, false);
  });

  it('opens settings on click and re-renders when the key changes elsewhere', async () => {
    const changes = [];
    const { chrome, text, button, mounted } = mount({}, { onChange: (connected) => changes.push(connected) });
    await mounted;
    button.click();
    assert.equal(chrome.opened.length, 1);

    await chrome.storage.local.set({ apiKey: 'vck_abcdefghijklmnop1234' });
    await settle();
    assert.match(text.textContent, /Connected via Vercel AI Gateway/);
    assert.deepEqual(changes, [false, true]);

    // Unrelated keys don't re-render.
    await chrome.storage.local.set({ theme: 'dark' });
    await settle();
    assert.deepEqual(changes, [false, true]);
  });
});
