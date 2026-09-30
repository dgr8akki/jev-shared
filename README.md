# jev-shared

The code that four Chrome extensions have in common: [Jev Voice](https://github.com/dgr8akki/jev-voice), [Slop Radar](https://github.com/dgr8akki/slop-radar), [Recipe Mode](https://github.com/dgr8akki/recipe-mode) and [Intent Guard](https://github.com/dgr8akki/intent-guard). All four call Jev, TypeSafe's decision model, through the same small client, connect a key on the same kind of settings page, and test themselves with the same helpers. Those files used to be copied by hand between the repos and drifted within days. Now they live here once.

## What is in `shared/`

`shared/` is laid out like a consumer repo, so a file keeps its path and its relative imports when copied.

`shared/src/lib/jev.js` is the HTTP client: providers, key masking, the `noul`/`boolean` translation between TypeSafe and Vercel, rate-limit pauses, one delayed retry on 5xx, a 20 second timeout, and `JevError` for everything that goes wrong, including a dead connection and a 200 that does not actually answer the questions.

`shared/src/lib/connection.js` renders the "Connected via … / Connect Jev" row in a popup or side panel. `shared/src/options/options.js` is the whole settings page script; the page supplies the markup and the look (icons come from `<template data-icon>` elements, the success line from `<body data-next>`). `shared/src/permission/permission.js` is the tab that asks for the microphone on a side panel's behalf. `shared/scripts/render-icons.js` renders the PNG icon sizes with headless Chrome.

`shared/test/helpers.js`, `shared/test/jev.test.js` and `shared/test/manifest-shared.js` are the test side: a Jev double, answer shorthands, a jsdom installer, the client's test suite, and the manifest assertions every extension repeats.

## Copies, not a package

The extensions have no build step. Chrome loads `src/` exactly as committed, so an npm dependency would still have to be copied into `src/lib/` by hand. Instead each consumer copies the files it needs and records where they came from in a `SHARED.md` at its root: the upstream URL, one pinned commit, and a table of upstream path to local path. [SHARED.md](SHARED.md) in this repo defines that format and has the block to paste.

## Syncing

`scripts/sync-shared.js` lives here and is copied into each consumer's `scripts/`. From a consumer's root:

```sh
node scripts/sync-shared.js main      # copy every listed file from main and pin its commit
node scripts/sync-shared.js           # restore the copies at the pinned commit
node scripts/sync-shared.js --check   # exit 1 and name each copy that differs
```

Files are fetched from GitHub at the pinned commit; while this repo is private that needs `JEV_SHARED_TOKEN` (or `GITHUB_TOKEN`) in the environment. Pass `--from ../jev-shared` (or set `JEV_SHARED_DIR`) to read from a local clone with `git show` instead, which works offline and needs no token. Node 22, no dependencies.

## The drift check

Each consumer's CI runs `node scripts/sync-shared.js --check` as the last step, after lint and tests. The script reads `SHARED.md`, fetches each listed file at the pinned commit, and compares bytes. Any difference prints `drift: src/lib/jev.js differs from shared/src/lib/jev.js` and fails the step, so a local edit to a shared file is caught at pull request time rather than found weeks later by diffing repos. `templates/consumer-ci-drift.yml` is the job to copy.

To change a shared file: change it here with a test, push, then run the sync in each consumer and commit the result there.

## Working on this repo

```sh
npm install
npm run check   # eslint, prettier --check, node --test
```

The tests run the extension pages against jsdom and a `chrome` double, so the settings page and the connection row are covered here even though the consumers only test their own logic. CI does the same on every push.

MIT, like the extensions.
