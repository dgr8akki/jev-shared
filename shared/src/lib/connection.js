// The "Connected via … / Connect Jev" row in a popup or side panel. The key itself is entered on the
// settings page, never here. Page contract: SHARED.md in dgr8akki/jev-shared.

import { DEFAULT_PROVIDER, PROVIDERS, maskKey } from './jev.js';

/** Reads the saved key and provider, as the service worker does for each call. */
export async function getConnection() {
  const { apiKey = '', provider } = await chrome.storage.local.get(['apiKey', 'provider']);
  return { apiKey, provider: PROVIDERS[provider] ? provider : DEFAULT_PROVIDER };
}

/**
 * Fills `text` and `button`, opens settings on click and re-renders when the
 * key changes in another tab. Button classes are toggled, not assigned, so a
 * base class such as `btn` survives; pass the page's own names when its
 * theme doesn't use `btn-primary` / `btn-secondary`.
 *
 * @param {HTMLElement} text
 * @param {HTMLButtonElement} button
 * @param {object} [options]
 * @param {(connected: boolean) => void} [options.onChange]
 * @param {string} [options.primaryClass] Class for the "Connect Jev" state.
 * @param {string} [options.secondaryClass] Class for the "Change" state.
 * @param {(provider: import('./jev.js').Provider) => string} [options.connectedText]
 *   Wording before the masked key once connected; defaults to "Connected via <label>".
 * @returns {Promise<boolean>} Whether a key is saved.
 */
export async function mountConnection(
  text,
  button,
  {
    onChange = () => {},
    primaryClass = 'btn-primary',
    secondaryClass = 'btn-secondary',
    connectedText = (provider) => `Connected via ${provider.label}`,
  } = {},
) {
  async function render() {
    const { apiKey, provider } = await getConnection();
    if (apiKey) {
      const key = Object.assign(document.createElement('span'), { className: 'mono', textContent: maskKey(apiKey) });
      text.replaceChildren(connectedText(PROVIDERS[provider]), key);
    } else {
      text.textContent = 'Connect a TypeSafe or Vercel AI Gateway key to start.';
    }
    button.textContent = apiKey ? 'Change' : 'Connect Jev';
    button.classList.toggle(primaryClass, !apiKey);
    button.classList.toggle(secondaryClass, Boolean(apiKey));
    onChange(Boolean(apiKey));
    return Boolean(apiKey);
  }
  button.addEventListener('click', () => chrome.runtime.openOptionsPage());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.apiKey || changes.provider)) render();
  });
  return render();
}
