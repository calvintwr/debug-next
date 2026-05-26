> _debugNEXT_ -- A feature-enhanced TypeScript drop-in replacement for a very popular and simple-to-use [debug][https://www.npmjs.com/package/debug] module.

![NodeJS Debugging Utility](https://user-images.githubusercontent.com/71256/29091486-fa38524c-7c37-11e7-895f-e7ec8e1039b6.png)

## Why debug-next?

Your logs are always either nothing, or flooded.

The simple yet elegant solution is namespacing so that you can have granular control over which parts of your code to log.

The original `debug` module exists in many popular frameworks, but it never grew in functionality. `debug-next` is a drop-in replacement that adds new features.

One problem that the original `debug` module had was that it indiscriminately log everything to error logs (`process.stderr` for Node environments / `console.error` for non-node environments). `debug-next` has new debuggers that follows mainstream conventions (`log`, `logDebug`, `logWarn`, `logError`, `logFatal`), and will log to normal or error logs depending on which is used:

```js
log('This is equivalent to console.log / process.stdout.write')
logError('This is equivalent to console.error / process.stderr.write')
```

## Installation

```
npm install --save debug-next
// or
yarn add debug-next
```

## Usage

### Code (index.js):

```js
import { debug } from 'debug-next'

const log = debug('namespace')
const logFoo = debug('namespace:foo')
const logBar = debug('namespace:bar')
const logBarChild = debug('namespace:bar:child')

log('Output from log.')
logFoo('Output from logFoo.')
logBar('Output from logBar.')
logBarChild('Output from logBarChild.')
```

### New Features - Automatic namespacing based on your folder structure

Your folder structure is your natural namespace. `debug-next` uses that by default to generate namespacing.

Say you have 2 files `index.js` and `foo.js`:

src/index.ts:

```js
import { Log, LogBase } from 'debug-next'
import * as foo from './foo'

// do this once in index/app/server.ts
LogBase.init('my-awesome-app', __dirname) // __dirname is a node global

const { log } = Log()
log('output from index')
```

foo.ts:

```js
import { Log } from 'debug-next'
const { log } = Log()
log('output from foo')
```

```console
DEBUG=my-awesome-app* node .

// Outputs:
my-awesome-app:index output from index
my-awesome-app:foo output from foo
```

### CLI:

#### Wildcard usage:

```console
$ DEBUG=namespace* node .

// logs
Output from log.
Output from logFoo.
Output from logBar.
Output from logBarChild.
```

#### Namespacing:

```bash
DEBUG=namespace:bar:* node .

// logs
Output from logBarChild.
```

#### De-matchers:

```bash
DEBUG=namespace*,-namespace:bar:child node .

// logs
Output from log.
Output from logFoo.
Output from logBar.

// logBarChild is de-matched.
```

## New features:

### Hooks:

Run any hooks with your debugging:

```js
// src/index.js
import { LogBase, Log } from 'debug-next'

const { log } = Log()

LogBase.init('myHookExampleApp', __dirname)

// adding hook too all loggers
LogBase.addHook('all', 'myHook', args => {
    // do something with the args they are passed into #log
    console.log('myHook is running...', ...args)
})

log('FOO')

// outputs: myHookExampleApp:src:index FOO
// outputs: myHook is running... FOO
```

You can use this to run any hooks you like, for example, capturing message and transporting to Sentry:

```js
LogBase.addHook('log', 'Sentry', (args, loggerType, isEnabled, scope, hookName) => {
    Sentry.captureMessage(
        `Captured messaged with arguments: ${args} ${loggerType} ${isEnabled} ${scope} ${hookName}`,
    )
})
```

### logVerbose

Smaller logs files will always help developers to debug faster. For logs that can generate multiple lines, use `logVerbose`:

```js
// simulating a data from API
const result = {
    id: '89dnk-5jkl6',
    success: true,
    // objects containing a lot of data
    payload: { ... },
    data: { ... },
}
logVerbose(`Log everything important in first argument. ID[${result.id}] success[${result.success}]`, result)
```

When in default mode (non-verbose mode), `logVerbose` will output:

```bash
app-name:filename.js Log everything important in first argument. ID[89dnk-5jkl6] success[true]| Verbose debugger available for: an object with keys [id,success,payload,data]
```

When in verbose mode (DEBUG_VERBOSE=true), `logVerbose` will output:

```bash
app-name:filename.js Log everything important in first argument. ID[89dnk-5jkl6] success[true] {
    id: '89dnk-5jkl6',
    success: true,
    payload: {
        // many
        // many
        // lines
    },
    data: {
        // many
        // many
        // lines
    },
}
```

### ENV options

Please see https://github.com/calvintwr/debug-next/blob/master/src/types/node.process.env.d.ts for a full list of ENV options and their explanation.

#### Recommended settings for maximum verbosity

```
DEBUG_VERBOSE=true
DEBUG_ERROR=true
DEBUG_DEPTH=5
DEBUG_SHOW_HIDDEN=true
DEBUG_GETTERS=true
```

#### Recommended settings for production

`debug-next` should run without settings in production.

Occassionally, you would want to only turn on namespaces for latest code changes:

```
DEBUG=namespace:with:latest-code-changes*
```

## Next.js

`debug-next/nextjs` captures errors from every Next.js error surface
(server runtime, client runtime, React render boundary, dev-server
output) and writes them verbatim to `<repo-root>/.debug-next/<appName>.log`.
The file is a faithful mirror of what scrolls by in the developer's
terminal — same format, same content, ANSI codes stripped. The AI
copilot reads the file the same way it would read the terminal.

### Install

```bash
npm install --save debug-next
# or
yarn add debug-next
# or
bun add debug-next
```

### 1. Server runtime — `instrumentation.ts`

Hook the LogBase file-writer on Node startup and replace `onRequestError`
with one that persists to the log file. Composes with Sentry if present:

```ts
// src/instrumentation.ts
import * as Sentry from '@sentry/nextjs'
import { attachFileWriter, createOnRequestError } from 'debug-next/nextjs'

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('../sentry.server.config') // if you use Sentry
        attachFileWriter({ appName: 'my-app' })
    }
}

export const onRequestError = createOnRequestError({
    appName: 'my-app',
    sentry: Sentry.captureRequestError, // optional
})
```

### 2. Client runtime — `instrumentation-client.ts`

Install `window.onerror` and `unhandledrejection` listeners that POST to
the route handler set up in step 3:

```ts
// src/instrumentation-client.ts
import { registerClientCapture } from 'debug-next/nextjs/client'

registerClientCapture({ appName: 'my-app' })
```

### 3. Receiving endpoint — `app/api/_debug-next/route.ts`

```ts
// app/api/_debug-next/route.ts (or src/app/... with the src/ layout)
import { createDebugNextRoute } from 'debug-next/nextjs/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const { POST } = createDebugNextRoute({ appName: 'my-app' })
```

> ⚠️ **Do not enable this endpoint in production.** It's an
> unauthenticated POST handler (it has to be — the browser fires
> `window.onerror` without credentials), writes attacker-controllable
> text into a file your AI session reads, and serves no durable purpose
> outside the dev loop. The handler short-circuits to `404` whenever
> `NODE_ENV=production` (unless you opt in with `DEBUG_NEXT_FORCE=true`,
> which you almost certainly shouldn't). Sentry is the right durable
> sink for production client errors. See the [Production](#production)
> section below.

### 4. React render boundary — `global-error.tsx` (optional)

```tsx
// app/global-error.tsx (or src/app/global-error.tsx if using the src/ layout)
'use client'
import { reportClientEvent } from 'debug-next/nextjs/client'
import { useEffect } from 'react'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
    useEffect(() => {
        reportClientEvent('/api/_debug-next', {
            appName: 'my-app',
            source: 'global-error',
            message: error.message,
            stack: error.stack,
            digest: error.digest,
        })
    }, [error])
    // ...render fallback
}
```

### 5. Dev-server build errors — `package.json`

Wrap the dev command with `debug-next-dev` to capture Turbopack/webpack
compile errors:

```jsonc
{
    "scripts": {
        "dev": "debug-next-dev -- next dev"
    }
}
```

### Log output

Raw stream at `<repo-root>/.debug-next/<appName>.log`. The CLI tees the
wrapped command's stdout/stderr verbatim. `LogBase` hooks and
synthesized events (Next.js `onRequestError`, client error reports) emit
terminal-style lines into the same file:

```
[2026-05-26T10:33:21.482Z] [debug-next-dev] wrapping: next dev
  ✓ Ready in 2.1s
[2026-05-26T10:33:22.001Z] [my-app] log src:workers:init: Worker started
[2026-05-26T10:33:25.910Z] [my-app] logError handleCheckout: Snag: Stripe charge failed
    at handleCheckout (/app/api/checkout/route.ts:42:15)
    at ... {
  breadcrumbs: [ { stage: 'checkout' }, { userId: 'u_123' } ],
  info: { amount: 4200, currency: 'usd' }
}
[2026-05-26T10:33:26.013Z] [my-app] logError route — POST /api/checkout
Error: Stripe charge failed
    at handleCheckout (/app/api/checkout/route.ts:42:15)
    at ...
```

Errors are rendered with `util.inspect`, so custom Error subclasses
(e.g. Snag's `breadcrumbs` / `info`) appear in the file instead of being
flattened to `err.stack`. The CLI also truncates the file at startup, so
each `bun run dev` begins from a clean slate.

### Session vs. history

`attachFileWriter` and the `debug-next-dev` CLI both truncate
`<appName>.log` once per process by default — every restart starts
fresh. Hot reloads inside a running process don't re-truncate (a
module-level Set tracks "already cleared this process"), so in-session
events aren't wiped.

If you'd rather accumulate logs across restarts (e.g. to grep across
yesterday's debug session), pass `resetOnStart: false`:

```ts
attachFileWriter({ appName: 'my-app', resetOnStart: false })
```

### Env overrides

| Variable | Default | Purpose |
|---|---|---|
| `DEBUG_NEXT_APP_NAME` | `package.json#name` (CLI only) | Override app name |
| `DEBUG_NEXT_LOG_DIR` | `<repo-root>/.debug-next` | Where log files are written |
| `DEBUG_NEXT_DISABLE` | unset | Set to `"true"` to disable file writes |
| `DEBUG_NEXT_FORCE` | unset | Required to enable file writes when `NODE_ENV=production` (disk logging is off by default in prod) |

Add `.debug-next/` to your `.gitignore`.

### Production

`debug-next/nextjs` is a **dev-loop tool**. Every write surface
short-circuits when `NODE_ENV=production`:

| Surface | Production default |
|---|---|
| `attachFileWriter` | `LogBase.init` still runs, but the file-writer hook is not attached |
| `pipeStdStreamsToFile` | Returns before wrapping `process.stdout` / `process.stderr` |
| `createOnRequestError` | `appendRaw` is called but no-ops; Sentry composition still fires |
| `createDebugNextRoute` POST | **Returns `404`** — the route refuses to parse the body |
| `registerClientCapture` | Browsers don't install the `window.onerror` / `unhandledrejection` listeners, so no client POSTs are fired |

The `DEBUG_NEXT_FORCE=true` env var re-enables all of the above for
self-hosted servers that genuinely want disk logs in prod, but think
hard before flipping it. In particular **never enable the route
handler in production**:

- The endpoint is unauthenticated (the browser can't send credentials
  for `window.onerror`).
- It writes attacker-controlled text into a file the AI copilot reads,
  which is a prompt-injection vector even with the newline / control-char
  sanitization applied to incoming fields.
- On Vercel / serverless, the filesystem is read-only or ephemeral, so
  the writes silently fail anyway.
- On self-hosted servers, the file grows without bound — there's no
  rotation.

Sentry is the right durable sink for production client errors.

## Roadmap:

1. Out-of-box support for Sentry.
