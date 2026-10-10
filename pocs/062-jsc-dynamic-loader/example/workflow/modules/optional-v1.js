const button = document.getElementById('tap');
const metrics = globalThis.workflowMetrics;
const onClick = () => { metrics.taps++; metrics.last = 'v1'; };
button.addEventListener('click', onClick);
module.onDispose(() => { button.removeEventListener('click', onClick); metrics.disposals++; });
module.exports = { version: 'v1' };
