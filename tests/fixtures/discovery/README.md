# Discovery test fixtures

Reusable `.jsonl` fixtures for the `src/discovery/*` module tests. Each file
is a literal Claude Code session-log shape (`{type, sessionId, cwd, message,
timestamp, lastPrompt?}`), one record per line.

| Fixture      | Purpose                                                                                       | Expected `parseJsonlFile` outcome                            |
| ------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `normal.jsonl`  | A well-formed session: `user` / `assistant` / `last-prompt` records with monotonic timestamps. | Returns a `SessionMeta` with `sessionId=fixture-normal`, `firstUserMessage` set, `lastPrompt` set, `lastTimestamp` = the last record's timestamp. |
| `corrupt.jsonl` | Mix of valid records and malformed lines (broken JSON, arrays where objects are expected).    | Returns a `SessionMeta` with `sessionId=fixture-corrupt`; the parser skips malformed lines without aborting. |
| `empty.jsonl`   | Zero-byte file.                                                                              | Returns `null` — no recoverable `sessionId`/`lastTimestamp`. |

## Usage

Prefer importing from `index.ts` over hard-coding paths:

```ts
import { fixtures } from '../fixtures/discovery/index.js';
import { parseJsonlFile } from '../../src/discovery/parse.js';

const meta = await parseJsonlFile(fixtures.normal);
```

The fixtures are committed under `tests/fixtures/discovery/` so they remain
stable across machines and CI; do not regenerate them per test run.