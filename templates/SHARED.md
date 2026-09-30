# Shared files

These files are copied from [jev-shared](https://github.com/dgr8akki/jev-shared) with `node scripts/sync-shared.js`. Do not edit them here: change them upstream, then re-sync. CI runs `node scripts/sync-shared.js --check` and fails when a copy differs from the pinned commit.

- Upstream: https://github.com/dgr8akki/jev-shared
- Commit: `0000000000000000000000000000000000000000`

| Upstream path                    | Local path                | Note                                            |
| -------------------------------- | ------------------------- | ----------------------------------------------- |
| `shared/src/lib/jev.js`          | `src/lib/jev.js`          |                                                 |
| `shared/src/lib/connection.js`   | `src/lib/connection.js`   | mounted with `{ primaryClass, secondaryClass }` |
| `shared/src/options/options.js`  | `src/options/options.js`  | page contract: see upstream SHARED.md           |
| `shared/test/jev.test.js`        | `test/jev.test.js`        |                                                 |
| `shared/test/helpers.js`         | `test/helpers.js`         |                                                 |
| `shared/test/manifest-shared.js` | `test/manifest-shared.js` |                                                 |
| `shared/scripts/render-icons.js` | `scripts/render-icons.js` |                                                 |
| `scripts/sync-shared.js`         | `scripts/sync-shared.js`  | keeps itself in sync                            |
