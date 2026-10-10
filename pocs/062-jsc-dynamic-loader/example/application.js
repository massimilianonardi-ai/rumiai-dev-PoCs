const counter = require('counter');
module.exports.run = () => counter.next();
module.onDispose(() => { globalThis.__pocApplicationDisposals = (globalThis.__pocApplicationDisposals || 0) + 1; });
