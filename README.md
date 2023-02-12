> _debugNEXT_ -- A feature-enhanced TypeScript drop-in replacement for a very popular and simple-to-use [debug][https://www.npmjs.com/package/debug] module.

![NodeJS Debugging Utility](https://user-images.githubusercontent.com/71256/29091486-fa38524c-7c37-11e7-895f-e7ec8e1039b6.png)

## Why debug-next?

You will soon realise no matter their functionaliy, your logs will be flooded in no time.

The simple yet elegant solution is namespacing so that you can have granular control over with part of your code to log.

The original `debug` module exists in many popular frameworks. But it never grew in functionality. `debug-next` is a drop-in replacement that adds new features.

One problem that the original `debug` module had was that it indiscriminately log everything to error logs (`process.stderr` for Node environments / `console.error` for non-node environments). `debug-next` has new debuggers that follows mainstream conventions (`log`, `logDebug`, `logWarn`, `logError`, `logFatal`), and will log to normal or error logs depending on which is used:

```js
log('This is equivalent to console.log / process.stdout.write')
logError('This is equivalent to console.error / process.stderr.write')
```

## Installation

```
npm install --save 'debug-next'
// or
yarn add 'debug-next'
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

## Roadmap:

1. Browser compatibility.
2. Support Winston transportation methodology.
3. Out-of-box support for Sentry.
