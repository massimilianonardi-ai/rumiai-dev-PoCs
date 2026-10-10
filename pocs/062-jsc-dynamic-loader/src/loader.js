/* jsc loader PoC: classic script, no eval and no ESM emulation. */
(function (host) {
  'use strict';
  const definitions = new Map();
  const instances = new Map();
  let changing = false;

  function identifier(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9._/-]*$/.test(value) || value.includes('..')) {
      throw new TypeError('invalid module identifier');
    }
    return value;
  }

  function validDefinition(id, deps, factory) {
    identifier(id);
    if (!Array.isArray(deps) || deps.some(dep => typeof dep !== 'string' || !dep || dep === id)) {
      throw new TypeError('invalid module dependencies');
    }
    deps.forEach(identifier);
    if (new Set(deps).size !== deps.length || typeof factory !== 'function') {
      throw new TypeError('invalid module definition');
    }
    return { deps: deps.slice(), factory };
  }


  function unlocked() {
    if (changing) throw new Error('module runtime is updating; reentrant operations are forbidden');
  }
  function graphCheck(graph) {
    const visiting = new Set(), done = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error(id + ': circular module dependencies');
      if (done.has(id)) return;
      visiting.add(id);
      for (const dep of graph.get(id).deps) {
        if (!graph.has(dep)) throw new Error(id + ': unavailable dependency ' + dep);
        visit(dep);
      }
      visiting.delete(id);
      done.add(id);
    }
    for (const id of graph.keys()) visit(id);
  }
  function affectedBy(ids) {
    const affected = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name, definition] of definitions) {
        if (!affected.has(name) && definition.deps.some(dep => affected.has(dep))) {
          affected.add(name);
          changed = true;
        }
      }
    }
    return affected;
  }
  function disposeAffected(affected) {
    const order = [], seen = new Set(), errors = [];
    function visit(name) {
      if (seen.has(name)) return;
      seen.add(name);
      for (const [consumer, definition] of definitions) {
        if (affected.has(consumer) && definition.deps.includes(name)) visit(consumer);
      }
      order.push(name);
    }
    for (const name of affected) visit(name);
    for (const name of order) {
      const instance = instances.get(name);
      if (!instance) continue;
      instances.delete(name);
      for (const dispose of instance.dispose.reverse()) {
        try { dispose(); } catch (error) { errors.push(error); }
      }
    }
    return { order, errors };
  }
  function invalidate(id) {
    unlocked();
    identifier(id);
    changing = true;
    try {
      const result = disposeAffected(affectedBy([id]));
      if (result.errors.length) throw new AggregateError(result.errors, 'module disposal failed');
      return result.order;
    } finally { changing = false; }
  }
  // Invalid or stale updates are rejected before touching working instances.
  // External disposal effects cannot be rolled back after cleanup starts.
  function installBatch(changes, { expectedRevisions } = {}) {
    unlocked();
    if (!Array.isArray(changes) || changes.length === 0) throw new TypeError('installBatch requires a nonempty array');
    const staged = new Map();
    for (const change of changes) {
      if (!change || Array.isArray(change) || typeof change !== 'object' ||
          Object.keys(change).some(key => !['id','deps','factory'].includes(key))) {
        throw new TypeError('invalid batch record');
      }
      const def = validDefinition(change.id, change.deps, change.factory);
      if (staged.has(change.id)) throw new Error('duplicate batch module: ' + change.id);
      staged.set(change.id, def);
    }
    if (expectedRevisions !== undefined) {
      if (!expectedRevisions || typeof expectedRevisions !== 'object' || Array.isArray(expectedRevisions) ||
          Object.keys(expectedRevisions).length !== staged.size) {
        throw new TypeError('expectedRevisions must specify every batch module');
      }
      for (const id of staged.keys()) {
        if (!Object.prototype.hasOwnProperty.call(expectedRevisions,id) ||
            !Number.isSafeInteger(expectedRevisions[id]) || expectedRevisions[id] < 0) {
          throw new TypeError('missing or invalid expected revision: ' + id);
        }
        if ((definitions.get(id)?.revision ?? 0) !== expectedRevisions[id]) throw new Error('stale module revision: ' + id);
      }
    }
    const candidate = new Map(definitions);
    for (const [id, entry] of staged) {
      const previous = definitions.get(id);
      candidate.set(id, { ...entry, revision: previous ? previous.revision + 1 : 1 });
    }
    graphCheck(candidate);
    const affected = affectedBy(staged.keys());
    changing = true;
    try {
      const cleanup = disposeAffected(affected);
      for (const id of staged.keys()) definitions.set(id, candidate.get(id));
      if (cleanup.errors.length) throw new AggregateError(cleanup.errors,
        'module cleanup failed; batch definitions committed; full reload may be necessary');
      return Array.from(staged.keys());
    } finally { changing = false; }
  }
  function install(id, deps, factory) {
    installBatch([{ id, deps, factory }]);
    return id;
  }
  function remove(id) {
    unlocked();
    identifier(id);
    if (!definitions.has(id)) return false;
    for (const [name, definition] of definitions) {
      if (name !== id && definition.deps.includes(id)) throw new Error('cannot remove module with registered dependents: ' + id);
    }
    invalidate(id);
    definitions.delete(id);
    return true;
  }

  function requireModule(id) {
    identifier(id);
    const cached = instances.get(id);
    if (cached) {
      if (cached.loading) throw new Error('circular module initialization: ' + id);
      return cached.module.exports;
    }
    const definition = definitions.get(id);
    if (!definition) throw new Error('module unavailable: ' + id);
    const module = { exports: {}, onDispose(callback) {
      if (typeof callback !== 'function') throw new TypeError('onDispose requires function');
      instance.dispose.push(callback);
    }};
    const instance = { module, dispose: [], loading: true };
    instances.set(id, instance);
    function localRequire(dep) {
      if (!definition.deps.includes(dep)) throw new Error(id + ': undeclared dependency: ' + dep);
      return requireModule(dep);
    }
    try {
      definition.factory(localRequire, module, module.exports);
      instance.loading = false;
      return module.exports;
    } catch (error) {
      instances.delete(id);
      for (const dispose of instance.dispose.reverse()) {
        try { dispose(); } catch { /* Preserve initialization error. */ }
      }
      throw error;
    }
  }

  function revision(id) {
    identifier(id);
    return definitions.get(id)?.revision ?? 0;
  }

  function state() {
    return { registered: definitions.size, active: instances.size, names: Array.from(instances.keys()) };
  }

  // Browser transport uses ordinary classic scripts, subject to actual server HTTP cache headers.
  // Expected module revision prevents a syntactically loaded but ineffective patch from reporting success.
  function loadScript(url, { nonce, expect } = {}) {
    if (typeof document === 'undefined') return Promise.reject(new Error('document unavailable'));
    if (expect !== undefined) identifier(expect);
    const prior = expect === undefined ? 0 : revision(expect);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      if (nonce) script.nonce = nonce;
      script.onload = () => {
        script.remove();
        if (expect !== undefined && revision(expect) <= prior) {
          reject(new Error('script loaded without installing expected module: ' + expect));
        } else resolve();
      };
      script.onerror = () => { script.remove(); reject(new Error('script load failed: ' + url)); };
      script.src = url;
      document.head.appendChild(script);
    });
  }

  const runtime = Object.freeze({ install, require: requireModule, invalidate, remove, state, revision, loadScript });
  if (host.JscRuntime !== undefined) throw new Error('JscRuntime already defined');
  Object.defineProperty(host, 'JscRuntime', { value: runtime, configurable: false, writable: false });
})(globalThis);
