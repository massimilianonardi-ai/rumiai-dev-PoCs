/* jsc loader PoC: classic script, no eval and no ESM emulation. */
(function (host) {
  'use strict';
  const definitions = new Map();
  const instances = new Map();

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

  function checkReplacement(id, next) {
    if (!definitions.has(id)) return; // Forward references may be registered during initial bundle setup.
    for (const dep of next.deps) {
      if (!definitions.has(dep)) throw new Error(`${id}: replacement has unavailable dependency ${dep}`);
    }
    const visited = new Set();
    function walk(current) {
      if (current === id) throw new Error(`${id}: replacement would create circular module dependencies`);
      if (visited.has(current)) return;
      visited.add(current);
      const entry = definitions.get(current);
      if (entry) for (const dep of entry.deps) walk(dep);
    }
    for (const dep of next.deps) walk(dep);
  }

  function activeConsumers(id) {
    const affected = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name] of instances) {
        const entry = definitions.get(name);
        if (!affected.has(name) && entry.deps.some(dep => affected.has(dep))) {
          affected.add(name);
          changed = true;
        }
      }
    }
    return affected;
  }

  function invalidate(id) {
    identifier(id);
    const affected = activeConsumers(id);
    const order = [];
    const visited = new Set();
    function visit(current) {
      if (visited.has(current)) return;
      visited.add(current);
      for (const name of affected) {
        if (name !== current && definitions.get(name)?.deps.includes(current)) visit(name);
      }
      order.push(current);
    }
    visit(id);
    const errors = [];
    for (const name of order) {
      const instance = instances.get(name);
      if (instance) {
        instances.delete(name);
        for (const dispose of instance.dispose.reverse()) {
          try { dispose(); } catch (error) { errors.push(error); }
        }
      }
    }
    if (errors.length) throw new AggregateError(errors, 'module disposal failed');
    return order;
  }

  function install(id, deps, factory) {
    const next = validDefinition(id, deps, factory);
    checkReplacement(id, next); // Never discard working instances on malformed dependency changes.
    const previous = definitions.get(id);
    if (previous) invalidate(id);
    next.revision = previous ? previous.revision + 1 : 1;
    definitions.set(id, next);
    return id;
  }

  function remove(id) {
    identifier(id);
    if (!definitions.has(id)) return false;
    const consumers = activeConsumers(id);
    const registered = Array.from(definitions).filter(([name, def]) => name !== id && def.deps.includes(id));
    if (registered.length || consumers.size > 1) throw new Error('cannot remove module with registered dependents: ' + id);
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
