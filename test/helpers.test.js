import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { choice, fakeJev, installDom, relevance, response, yesNo } from '../shared/test/helpers.js';

describe('test helpers', () => {
  it('fakeJev records calls and answers through respond', async () => {
    const jev = fakeJev((body) => ({ echoed: body.state }));
    assert.deepEqual(await jev.evaluate({ state: 'x', questions: {} }), { echoed: 'x' });
    assert.equal(jev.calls.length, 1);
    assert.deepEqual(Object.keys(jev), ['calls', 'evaluate'], 'same surface as the real client plus calls');
  });

  it('builds the answer shapes the four extensions read', () => {
    assert.deepEqual(choice('yes'), { type: 'choice', choice: 'yes', confidence: 0.95, probabilities: { yes: 0.95 } });
    assert.deepEqual(yesNo(0.2), { type: 'boolean', probability: 0.2 });
    assert.deepEqual(relevance(0.1, 0.2, 0.3, 0.4), {
      relevance: { type: 'score', probabilities: { 0: 0.1, 1: 0.2, 2: 0.3, 3: 0.4 } },
    });
  });

  it('installDom exposes the page at the given url and restores the globals', () => {
    const before = globalThis.document;
    const restore = installDom('<p id="p">hi</p>', 'https://www.linkedin.com/feed/');
    assert.equal(globalThis.document.getElementById('p').textContent, 'hi');
    assert.equal(globalThis.window.location.href, 'https://www.linkedin.com/feed/');
    assert.equal(typeof globalThis.KeyboardEvent, 'function');
    assert.equal(globalThis.matchMedia('(prefers-reduced-motion)').matches, false);
    restore();
    assert.equal(globalThis.document, before);
  });

  it('installDom defaults to example.com', () => {
    const restore = installDom('<p></p>');
    assert.equal(globalThis.window.location.origin, 'https://example.com');
    restore();
  });

  it('response reads headers case-insensitively', async () => {
    const res = response(429, { a: 1 }, { 'retry-after': '5' });
    assert.equal(res.ok, false);
    assert.equal(res.headers.get('Retry-After'), '5');
    assert.deepEqual(await res.json(), { a: 1 });
  });
});
