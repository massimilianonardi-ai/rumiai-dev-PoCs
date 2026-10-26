NAME
    jsc.lib.js - Node.js strict JavaScript namespace and CSS source compiler

DESCRIPTION
    This non-executable CommonJS library implements the ordered jsc compiler.
    It reads the nested modules/name/file descriptor, optional comma-separated
    exports, optional reference-only imports and root-level nodeGlobal.
    JavaScript output uses strict nested closures, exports namespace objects
    without eval, and supports browser globals or CommonJS module.exports.
    CSS files are concatenated in their stated order.

PUBLIC FUNCTION
    jscMain(args)
        Async function returning a Promise of a numeric process-style status.
        Accepts [manifestPath] or [manifestPath, outputPath]. With one
        argument, generated source goes exclusively to stdout. With two,
        generated source is written directly to outputPath.

        A missing source, invalid descriptor, invalid import/export, unsafe
        source path or invalid generated JavaScript is rejected. JavaScript
        is parsed with Node's vm.Script and, when installed, additionally
        checked non-destructively by google-closure-compiler --checks_only.
        CSS output is not passed to Closure Compiler.

        The public jsc launcher, not jscMain, handles installed-minifier
        artifacts and gzip output. Calling jscMain directly does not produce
        minified or gzipped files.

        On error it writes [error] [jsc.<branch>] and returns a nonzero
        status (1 invalid arguments, 2 compilation, 3 Closure checking,
        4 output). It does not terminate the caller.

    Example:
        const {jscMain} = require('/path/to/jsc-package-root/lib/jsc.lib.js');
        const status = await jscMain(['modules-js.json', 'bundle.js']);

    Direct execution:
        node /path/to/jsc-package-root/lib/jsc.lib.js modules-js.json

    Normal use:
        jsc modules-js.json bundle.js

DEPENDENCIES
    Node.js standard fs, path, vm, os and child_process.
    google-closure-compiler is optional and never downloaded implicitly.

FILES
    <jsc-package-root>/lib/jsc.lib.js
    <jsc-package-root>/bin/jsc

SEE ALSO
    package-local jsc manual
