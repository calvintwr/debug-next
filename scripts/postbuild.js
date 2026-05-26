#!/usr/bin/env node
/**
 * Postbuild step for the `debug-next-dev` CLI:
 *
 *   1. Prepend `#!/usr/bin/env node` if the compiled file is missing it.
 *      Some editors/formatters strip shebangs from `.ts` source files,
 *      which then propagates to the `.js` output and makes the CLI
 *      unexecutable (the shell tries to interpret it as a script and
 *      fails on `"use strict";`). This step makes the shebang
 *      independent of the source file's state.
 *
 *   2. `chmod +x` so the `node_modules/.bin/debug-next-dev` symlink
 *      resolves to an executable target.
 */

const fs = require('fs')

const target = './dist/bin/debug-next-dev.js'
const shebang = '#!/usr/bin/env node\n'

if (!fs.existsSync(target)) {
    // Nothing to do — let the build itself fail loudly if dist is missing.
    process.exit(0)
}

const content = fs.readFileSync(target, 'utf-8')
if (!content.startsWith('#!')) {
    fs.writeFileSync(target, shebang + content)
}

fs.chmodSync(target, 0o755)
