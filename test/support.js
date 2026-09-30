/**
 * Test doubles for the extension pages under shared/src: a `chrome` API fake
 * and a jsdom installer. Only used by this repo's own tests; consumers test
 * their pages against their own HTML.
 */

import { JSDOM } from 'jsdom';

/**
 * A `chrome` double with `storage.local`, `storage.onChanged` and
 * `runtime.openOptionsPage`. `store` is the backing object, exposed so tests
 * can read what was saved.
 *
 * @param {Record<string, unknown>} [store]
 */
export function fakeChrome(store = {}) {
  const listeners = [];
  const fire = (changes) => listeners.forEach((listener) => listener(changes, 'local'));
  const opened = [];
  return {
    store,
    opened,
    storage: {
      local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.filter((name) => name in store).map((name) => [name, store[name]]));
        },
        async set(values) {
          const changes = Object.fromEntries(
            Object.entries(values).map(([name, value]) => [name, { oldValue: store[name], newValue: value }]),
          );
          Object.assign(store, values);
          fire(changes);
        },
        async remove(key) {
          const changes = { [key]: { oldValue: store[key] } };
          delete store[key];
          fire(changes);
        },
      },
      onChanged: {
        addListener: (listener) => listeners.push(listener),
        fire,
      },
    },
    runtime: { openOptionsPage: () => opened.push(Date.now()) },
  };
}

/**
 * Exposes a jsdom page as the globals an extension page script expects,
 * plus `chrome`. Returns a restore function.
 *
 * @param {string} html
 * @param {ReturnType<typeof fakeChrome>} chrome
 */
export function installPage(html, chrome) {
  const { window } = new JSDOM(html, { url: 'chrome-extension://test/options.html', pretendToBeVisual: true });
  const names = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLButtonElement',
    'Event',
    'InputEvent',
    'chrome',
  ];
  // defineProperty, not assignment: Node exposes `navigator` through a getter-only accessor.
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const name of names) define(name, name === 'window' ? window : name === 'chrome' ? chrome : window[name]);
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

/** Waits for pending promises (storage reads, module top-level awaits) to settle. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
