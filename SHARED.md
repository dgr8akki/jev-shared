# The SHARED.md convention

Each extension repo that copies files from here carries a `SHARED.md` at its root. It does two jobs. For a reader, it explains why the same file appears byte for byte in four sibling repos: they are copies of one source, pinned to one commit, not four coincidences. For `scripts/sync-shared.js`, it is the manifest: where upstream is, which commit the copies came from, and which file goes where.

## Format

The script reads three things and ignores everything else, so the rest of the file is free prose.

1. A list item `- Upstream: <url>`, the GitHub URL of this repo.
2. A list item `- Commit: <sha>`, the full 40-character commit the copies were taken from. Backticks around the sha are fine. The script rewrites this line when it syncs.
3. A table whose first column is the upstream path and second column the local path. A third column is free text: say how the file is parameterised (for example which class names `mountConnection` is given) or anything else a reader would want. The header row and the `---` separator are skipped, backticks around paths are stripped, and prettier may re-align the columns without breaking anything.

Paths are relative to each repo's root. Because `shared/` mirrors a consumer's tree, `shared/src/lib/jev.js` lands at `src/lib/jev.js` with its relative imports intact. The one exception is `scripts/sync-shared.js`, which lives at the root here and maps to the same path in the consumer, so the script keeps itself in sync too.

## Paste this into a consumer

`templates/SHARED.md` is the file to copy. Delete the rows for files the repo does not use (intent-guard has no `connection.js`, only the two side-panel extensions have `permission.js`), then run the sync once with a ref so the placeholder commit is replaced:

```markdown
# Shared files

These files are copied from [jev-shared](https://github.com/dgr8akki/jev-shared) with `node scripts/sync-shared.js`. Do not edit them here: change them upstream, then re-sync. CI runs `node scripts/sync-shared.js --check` and fails when a copy differs from the pinned commit.

- Upstream: https://github.com/dgr8akki/jev-shared
- Commit: `0000000000000000000000000000000000000000`

| Upstream path                    | Local path                | Note                                                                  |
| -------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `shared/src/lib/jev.js`          | `src/lib/jev.js`          | worker passes `pauseStore: sessionPauseStore(chrome.storage.session)` |
| `shared/src/lib/connection.js`   | `src/lib/connection.js`   | mounted with `{ primaryClass, secondaryClass, connectedText }`        |
| `shared/src/options/options.js`  | `src/options/options.js`  | page contract below                                                   |
| `shared/test/jev.test.js`        | `test/jev.test.js`        |                                                                       |
| `shared/test/helpers.js`         | `test/helpers.js`         |                                                                       |
| `shared/test/manifest-shared.js` | `test/manifest-shared.js` |                                                                       |
| `shared/scripts/render-icons.js` | `scripts/render-icons.js` |                                                                       |
| `scripts/sync-shared.js`         | `scripts/sync-shared.js`  | keeps itself in sync                                                  |
```

## What `jev.js` needs from its worker

Nothing to run, but the 429 pause is kept in module memory unless told otherwise, and a service-worker restart forgets it. Each worker should create its client with the session store so the next command after a restart still waits out the backoff:

```js
import { createJevClient, sessionPauseStore } from './lib/jev.js';

const jev = createJevClient({
  getKey: async () => (await chrome.storage.local.get('apiKey')).apiKey ?? '',
  getProvider: async () => (await chrome.storage.local.get('provider')).provider,
  pauseStore: sessionPauseStore(chrome.storage.session),
});
```

The key is `jev:pausedUntil` (pass a second argument to change it). Pages that create a throwaway client for a key check, like `options.js`, can leave `pauseStore` out.

## What `options.js` needs from its page

The script is the same in all four repos; the HTML and CSS are not. A settings page that adopts it must have these ids: `key-form` (containing radios named `provider` and a `button[type="submit"]`), `api-key`, `cancel`, `connected`, `test`, `replace`, `remove`, `key-status`, `connected-status`, `steps`, `host`, `provider-label`, `masked`. `kicker` is optional and receives Welcome, Replace your key or Settings. Focus moves to `#test` after Connect, to `#replace` after Cancel and to `#api-key` after Remove, so those three must be focusable buttons and a field, not headings.

On `<body>`: `data-next` is the sentence appended to "Key works." after connecting (for example "Reload LinkedIn to see labels."); `data-app` is the product name used in console errors, falling back to the page `<title>`. `body[data-state]` is set to `welcome`, `replace` or `connected` for CSS.

Status lines get `data-tone` of `busy`, `ok`, `error` or `neutral`. A page can style those tones in CSS alone, or add `<template data-icon="busy|ok|error|neutral">` elements whose content is cloned in front of the text, so no state relies on colour. The busy mark is also cloned into the button while a check runs.

## What `permission.js` needs from its page

`#allow` (a button) and `#status` (a `role="status"` element). Once the microphone is granted, the script moves focus to `#status` and then disables the button, so a keyboard user is not left on `<body>`; it adds `tabindex="-1"` to `#status` itself if the page has not.

## Commands

Run these from the consumer's root. The script needs Node 22 and nothing else.

```sh
# First time: fetch scripts/sync-shared.js by hand, then let it fetch the rest.
curl -fsSL https://raw.githubusercontent.com/dgr8akki/jev-shared/main/scripts/sync-shared.js -o scripts/sync-shared.js

# Copy every listed file from a ref (branch, tag or sha) and pin its commit in SHARED.md.
node scripts/sync-shared.js main

# Put edited copies back the way the pinned commit has them.
node scripts/sync-shared.js

# Exit 1 and name every copy that differs from the pinned commit. This is the CI step.
node scripts/sync-shared.js --check

# Read from a local clone instead of GitHub (also works offline, and needs no token).
node scripts/sync-shared.js main --from ../jev-shared
JEV_SHARED_DIR=../jev-shared node scripts/sync-shared.js --check

# While jev-shared is private, GitHub reads need a token that can see it (JEV_SHARED_TOKEN or GITHUB_TOKEN).
JEV_SHARED_TOKEN=<token> node scripts/sync-shared.js --check
```

Without a token the script uses raw.githubusercontent.com. With one it sends `Authorization: Bearer` and reads files through the GitHub contents API (`Accept: application/vnd.github.raw+json`), because raw.githubusercontent.com does not take tokens reliably. A 404 with no token ends with a one-line hint about `JEV_SHARED_TOKEN`.

## The CI drift check

`templates/consumer-ci-drift.yml` is the consumers' CI job with one step appended: `node scripts/sync-shared.js --check`. Copy the file over `.github/workflows/ci.yml`, or add just that step to the existing check job. It goes after `npm test` on purpose: a drift failure must never hide lint or test results, which it did when it ran first and 404ed. The step prints one `drift: <local path> differs from <upstream path>` line per file (or `is missing`) and exits 1; an unmodified checkout prints `N shared files match … @ <sha>` and exits 0.

While jev-shared is private the step needs `JEV_SHARED_TOKEN`, a repository secret holding a GitHub token that can read jev-shared (a fine-grained token with contents read on that one repo is enough). The template also sets `continue-on-error: true` so a missing secret does not fail every build; remove that line once the shared repo is public and the token is no longer needed.

## When a copy has to differ

It should not. If a consumer needs different behaviour, add a parameter upstream (that is how `connection.js` got `primaryClass` and `options.js` got `data-icon` templates), push, and re-sync everywhere. If a file genuinely stops being shared, remove its row from the table and say why in the prose above it; the check only covers listed files, so the reason has to be written down where the next reader will look.
