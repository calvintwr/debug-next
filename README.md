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

#### Usage with ES Modules

ES modules - module system is different from commonjs or bun run time.
ES modules hoists (lift all the imports statements) first before executing any codes. This can result and unexpected bugs if the namespace initialization is not managed carefully.

For example, suppose you have the following files:
```ts
/*
// .env
DEBUG=my-awesome-app*

.
└── src
    ├── index.ts
    └── routes.ts
 */

// index.ts
import { fileURLToPath } from "url";
import { dirname } from "path";

import { Log, LogBase } from 'debug-next'

// initialization comes first
function getDirname(metaUrl: string) {
  const __filename = fileURLToPath(metaUrl);
  return dirname(__filename);
}
LogBase.init('my-awesome-app', getDirname(import.meta.url)) // <- set the name space here

import './routes'

// routes.ts
import { Log } from 'debug-next'
const { log } = Log(import.meta.filename)
```

Only the log statement from `index.ts` will be printed out to console because, es modules resolve hoist the `import './routes.ts'` line.
And hence the code inside the `routes.ts` gets executed earlier than LogBase initialization. 
The namespace for Log inside the `routes.ts` will be default `debug` other than `my-awesome-app`.

To fix this problem, you can segregate the `LogBase` initialization into a separate file and put the import at the top. Look at the below example.

```ts
/*
└── src
    ├── index.ts
    ├── init-logger.ts
    └── routes.ts
*/

// init-logger.ts
import { LogBase } from "debug-next";
import { getDirname } from "./lib/getDirname";

// Initialize LogBase
LogBase.init("my-awesome-app", getDirname(import.meta.url));

// index.ts
import("./logger"); // <- This must be at the top.
import('./routes');
// import other files here
```

This way, initialization will get executed first as it is the code inside the first import statement.


## Browser & edge runtimes

`debug-next` is safe to import in non-Node runtimes (browser, edge). The
loggers detect when `process.stdout` is unavailable and fall back to
`console.log` / `console.error`, so the bundle won't crash when it runs
outside Node:

```js
import { debug } from 'debug-next'

const log = debug('namespace')
log('Works in the browser too — routed through console.log') // no `process.stdout` required
```

Bun is also detected at runtime via an optional-chaining guard, so the
caller-callsite namespacing degrades gracefully where `process.versions`
is absent.


## Roadmap:

1. ~~Browser compatibility.~~ ✅
2. Support Winston transportation methodology.
3. Out-of-box support for Sentry.
