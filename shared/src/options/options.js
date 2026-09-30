/**
 * Settings page, opened on install: picks the Jev provider and connects its
 * key. A saved key is never put back into the input; it shows as a masked
 * chip with Test, Replace and Remove.
 *
 * The page supplies the look, this file the behaviour. It expects these ids:
 * key-form (with radios named `provider`), api-key, cancel, connected, test,
 * replace, remove, key-status, connected-status, steps, host, provider-label,
 * masked. Optional: kicker (gets Welcome / Replace your key / Settings).
 * `<body data-next="…">` is appended to "Key works." after connecting, and
 * `body[data-state]` is welcome, replace or connected for CSS to hook into.
 * Status lines get `data-tone` (busy, ok, error, neutral); a page can either
 * style the tone in CSS alone or provide `<template data-icon="ok">` elements
 * whose content is cloned in front of the text, so no status relies on colour.
 */

import { DEFAULT_PROVIDER, PROVIDERS, createJevClient, maskKey } from '../lib/jev.js';

/** Outbound links carry a ↗ mark and a hidden "(opens in a new tab)". Trusted constants, so innerHTML is fine. */
const EXTERNAL =
  '<svg class="external" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="visually-hidden"> (opens in a new tab)</span>';
const link = (href, text) => `<a href="${href}" target="_blank" rel="noreferrer">${text}${EXTERNAL}</a>`;
const STEPS = {
  vercel: [
    `${link(PROVIDERS.vercel.keysUrl, 'Create an AI Gateway API key')} in the Vercel dashboard.`,
    `Set a ${link('https://vercel.com/docs/ai-gateway/observability-and-spend/budgets', 'spend limit')} on it (optional, recommended).`,
    'Paste it here.',
  ],
  typesafe: [`${link(PROVIDERS.typesafe.keysUrl, 'Create an API key')} in the TypeSafe console.`, 'Paste it here.'],
};

const $ = (id) => document.getElementById(id);
const form = $('key-form');
const input = $('api-key');
const cancel = $('cancel');
const connected = $('connected');
const submit = form.querySelector('button[type="submit"]');
const testButton = $('test');
const formStatus = $('key-status');
const connectedStatus = $('connected-status');
const radios = [...form.elements.provider];

/** The page's own mark for a tone, if it provides one. */
const icon = (tone) => document.querySelector(`template[data-icon="${tone}"]`)?.content.cloneNode(true);

let { apiKey = '', provider = DEFAULT_PROVIDER } = await chrome.storage.local.get(['apiKey', 'provider']);
if (!PROVIDERS[provider]) provider = DEFAULT_PROVIDER;
render();

const selected = () => radios.find((radio) => radio.checked)?.value ?? provider;

/** Steps, placeholder and privacy line follow the provider being shown. */
function showProvider(id) {
  $('steps').innerHTML = STEPS[id].map((step) => `<li><span>${step}</span></li>`).join('');
  input.placeholder = PROVIDERS[id].placeholder;
  $('host').textContent = PROVIDERS[id].host;
}

function render(editing = false) {
  const showForm = editing || !apiKey;
  form.hidden = !showForm;
  connected.hidden = showForm;
  cancel.hidden = !apiKey;
  // Same page on install and later; only the heading changes.
  const state = !showForm ? 'connected' : apiKey ? 'replace' : 'welcome';
  document.body.dataset.state = state;
  const kicker = $('kicker');
  if (kicker) kicker.textContent = { connected: 'Settings', replace: 'Replace your key', welcome: 'Welcome' }[state];
  input.value = '';
  setInvalid(false);
  radios.forEach((radio) => (radio.checked = radio.value === provider));
  showProvider(provider);
  $('provider-label').textContent = PROVIDERS[provider].label;
  $('masked').textContent = maskKey(apiKey);
  if (showForm) input.focus({ preventScroll: true }); // keep the welcome headline in view
}

radios.forEach((radio) =>
  radio.addEventListener('change', () => {
    showProvider(selected());
    setStatus(formStatus, '');
    input.focus({ preventScroll: true });
  }),
);

input.addEventListener('input', () => {
  if (input.getAttribute('aria-invalid') === 'true') {
    setInvalid(false);
    setStatus(formStatus, '');
  }
});

/** Resolves with an error message, or '' when the key works. */
async function test(id, key) {
  try {
    await createJevClient({ getKey: () => key, getProvider: () => id }).evaluate({
      state: 'ping',
      questions: {
        ok: { type: 'choice', instructions: 'Is this a test message?', criteria: { yes: 'Yes', no: 'No' } },
      },
    });
    return '';
  } catch (error) {
    // A busy provider still accepted the key.
    return error.busy ? '' : error.message;
  }
}

/** @param {'busy' | 'ok' | 'error' | 'neutral'} [tone] */
function setStatus(el, text, tone = 'neutral') {
  el.replaceChildren();
  if (!text) return delete el.dataset.tone;
  el.dataset.tone = tone;
  el.append(...[icon(tone)].filter(Boolean), Object.assign(document.createElement('span'), { textContent: text }));
}

function setInvalid(invalid) {
  input.setAttribute('aria-invalid', String(invalid));
}

/** Spinner plus label while a check runs; the input stays put but can't change underneath it. */
function setBusy(button, busy, label) {
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  button.replaceChildren(...[busy && icon('busy')].filter(Boolean), label);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = selected();
  const key = input.value.trim();
  if (!key) return input.focus({ preventScroll: true });
  setInvalid(false);
  input.readOnly = true;
  setBusy(submit, true, 'Checking…');
  setStatus(formStatus, `Checking key with ${PROVIDERS[id].label}…`, 'busy');
  const error = await test(id, key);
  input.readOnly = false;
  setBusy(submit, false, 'Connect');
  if (error) {
    setInvalid(true);
    return setStatus(formStatus, error, 'error');
  }
  apiKey = key;
  provider = id;
  await chrome.storage.local.set({ apiKey, provider });
  setStatus(formStatus, '');
  render();
  setStatus(connectedStatus, ['Key works.', document.body.dataset.next].filter(Boolean).join(' '), 'ok');
});

testButton.addEventListener('click', async () => {
  setBusy(testButton, true, 'Test');
  setStatus(connectedStatus, 'Checking key…', 'busy');
  const error = await test(provider, apiKey);
  setBusy(testButton, false, 'Test');
  setStatus(connectedStatus, error || 'Key works.', error ? 'error' : 'ok');
});

$('replace').addEventListener('click', () => {
  setStatus(connectedStatus, '');
  render(true);
});
cancel.addEventListener('click', () => {
  setStatus(formStatus, '');
  render();
});

$('remove').addEventListener('click', async () => {
  await chrome.storage.local.remove('apiKey');
  apiKey = '';
  setStatus(connectedStatus, '');
  render();
  setStatus(formStatus, 'Key removed from this browser.', 'neutral');
});
