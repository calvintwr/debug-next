> _debugTS_ -- A feature-enhanced TypeScript drop-in replacement for a very popular and simple-to-use [debug][https://www.npmjs.com/package/debug] module.

![NodeJS Debugging Utility](https://user-images.githubusercontent.com/71256/29091486-fa38524c-7c37-11e7-895f-e7ec8e1039b6.png)

## Why debugTS?

You will soon realise no matter their functionaliy, your logs will be flooded in no time.

The simple yet elegant solution is namespacing so that you can have granular control over with part of your code to log.

The original `debug` module exists in many popular frameworks. But it never grew in functionality. `debugTS` is a drop-in replacement that adds new features.

One problem that the original `debug` module had was that it indiscriminately log everything to error logs (`process.stderr` for Node environments / `console.error` for non-node environments)

## Installation

```
npm install --save 'debugts'
// or
yarn add 'debugts'
```

## Usage

### Code (index.js):

```js
import { debug } from 'debugts'

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

Your folder structure is your natural namespace. `debugTS` uses that by default to generate namespacing.

Say you have 2 files `index.js` and `foo.js`:

src/index.ts:

```js
import { Log, LogBase } from 'debugts'
import * as foo from './foo'

// do this once in index/app/server.ts
LogBase.init('my-awesome-app', __dirname) // __dirname is a node global

const { log } = Log()
log('output from index')
```

foo.ts:

```js
import { Log } from 'debugts'
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
import { LogBase, Log } from 'debugts'

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

## Roadmap:

1. Browser compatibility.
2. Support Winston transportation methodology.
3. Out-of-box support for Sentry.
