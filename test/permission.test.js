import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { fakeChrome, installPage, settle } from './support.js';

const HTML = '<button id="allow" type="button">Allow microphone</button><p id="status" role="status"></p>';
let restore = () => {};
let seq = 0;
afterEach(() => restore());

/** Loads permission.js against a page whose getUserMedia behaves as `media` says. */
async function load(media) {
  restore = installPage(HTML, fakeChrome());
  const stopped = [];
  globalThis.window.navigator.mediaDevices = {
    getUserMedia: async (constraints) => {
      media.calls.push(constraints);
      if (media.error) throw media.error;
      return { getTracks: () => [{ stop: () => stopped.push('audio') }] };
    },
  };
  await import(`../shared/src/permission/permission.js?case=${seq++}`);
  await settle();
  const $ = (id) => globalThis.document.getElementById(id);
  return { $, stopped };
}

describe('permission page', () => {
  it('asks for the microphone on load, stops the track and disables Allow', async () => {
    const media = { calls: [] };
    const { $, stopped } = await load(media);
    assert.deepEqual(media.calls, [{ audio: true }]);
    assert.deepEqual(stopped, ['audio']);
    assert.match($('status').textContent, /^Microphone allowed\./);
    assert.equal($('status').className, 'status ok');
    assert.equal($('allow').disabled, true);
  });

  it('moves focus to the status before disabling the focused Allow button', async () => {
    const media = { calls: [], error: new Error('first try blocked') };
    const { $ } = await load(media);
    $('allow').focus();
    assert.equal(globalThis.document.activeElement, $('allow'));
    delete media.error;
    $('allow').click();
    await settle();
    assert.equal(globalThis.document.activeElement, $('status'), 'focus fell off the disabled button');
    assert.equal($('status').getAttribute('tabindex'), '-1', 'status made focusable');
    assert.equal($('allow').disabled, true);
  });

  it('names the error and keeps Allow enabled when blocked', async () => {
    const error = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const media = { calls: [], error };
    const { $ } = await load(media);
    assert.match($('status').textContent, /^Microphone blocked \(NotAllowedError\)\. Click the icon/);
    assert.equal($('status').className, 'status error');
    assert.equal($('allow').disabled, false);

    delete media.error;
    $('allow').click();
    await settle();
    assert.equal(media.calls.length, 2);
    assert.equal($('status').className, 'status ok');
  });
});
