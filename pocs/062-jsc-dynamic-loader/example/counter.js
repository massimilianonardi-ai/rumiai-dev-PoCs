globalThis.__pocCounterEvaluations = (globalThis.__pocCounterEvaluations || 0) + 1;
let count = 0;
module.exports.next = () => ++count;
module.onDispose(() => { globalThis.__pocCounterDisposals = (globalThis.__pocCounterDisposals || 0) + 1; });
