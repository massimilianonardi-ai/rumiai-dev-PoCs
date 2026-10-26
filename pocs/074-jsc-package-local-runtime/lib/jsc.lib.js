'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

function _identifier(value)
{
  return typeof value === 'string' && /^[A-Za-z_$][\w$]*$/.test(value) &&
    !/^(?:await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|with|yield|let|static|implements|interface|package|private|protected|public)$/.test(value) &&
    !['__proto__','constructor','prototype'].includes(value);
}

function _assertIdentifier(name, role)
{
  if (!_identifier(name)) throw new Error('invalid ' + role + ': ' + String(name));
}

function _sourcePath(dir, file)
{
  if (typeof file !== 'string' || !file || path.isAbsolute(file))
    throw new Error('invalid source path: ' + String(file));
  const full = path.resolve(dir, file);
  const rel = path.relative(dir, full);
  if (rel === '..' || rel.startsWith('..' + path.sep))
    throw new Error('source outside descriptor directory: ' + file);
  const real = fs.realpathSync(full);
  const base = fs.realpathSync(dir);
  const realRel = path.relative(base, real);
  if (realRel === '..' || realRel.startsWith('..' + path.sep))
    throw new Error('source outside descriptor directory: ' + file);
  return full;
}

function _collectType(nodes, types)
{
  for (const node of nodes)
  {
    if (node.modules !== undefined)
    {
      if (!Array.isArray(node.modules)) throw new Error('namespace modules must be an array');
      if (node.name !== undefined) _assertIdentifier(node.name, 'namespace');
      _collectType(node.modules, types);
    }
    else if (node.file !== undefined)
    {
      if (typeof node.file !== 'string') throw new Error('invalid source file');
      types.add(path.extname(node.file).toLowerCase());
    }
    else
    {
      throw new Error('invalid source descriptor entry');
    }
  }
}

function _readExports(node)
{
  if (node.exports === undefined || node.exports === '') return [];
  if (typeof node.exports !== 'string') throw new Error('exports must be a string');
  return node.exports.split(',').map(s => s.trim()).map
  (
    name =>
    {
      _assertIdentifier(name, 'export');
      return name;
    }
  );
}

function _makeImports(node)
{
  if (node.imports === undefined) return '';
  if (!node.imports || typeof node.imports !== 'object' || Array.isArray(node.imports))
    throw new Error('imports must be an object');
  let code = '';
  for (const [local, qualified] of Object.entries(node.imports))
  {
    _assertIdentifier(local, 'import');
    if (typeof qualified !== 'string' || !qualified.split('.').every(_identifier) || qualified.indexOf('.') < 0)
      throw new Error('invalid import reference for ' + local);
    code += `var ${local} = ${qualified};\n`;
  }
  return code;
}

function _renderNodes(nodes, dir, level = 0)
{
  let code = '';
  for (const node of nodes)
  {
    if (node.modules !== undefined)
    {
      if (node.name === undefined)
      {
        code += _renderNodes(node.modules, dir, level);
        continue;
      }
      _assertIdentifier(node.name, 'namespace');
      const name = node.name;
      if (level === 0)
      {
        code += `var ${name} = isNode && !shareGlobal ? {} : (global.${name} || (global.${name} = {}));\n`;
        code += `publicRoots.${name} = ${name};\n`;
      }
      else
      {
        code += `var ${name} = this.${name} || (this.${name} = {});\n`;
      }
      code += `(function ()\n{\n${_renderNodes(node.modules, dir, level + 1)}\n}\n).call(${name});\n`;
    }
    else if (node.file !== undefined)
    {
      code += _makeImports(node);
      code += fs.readFileSync(_sourcePath(dir, node.file), 'utf8') + '\n';
      for (const name of _readExports(node)) code += `this.${name} = ${name};\n`;
    }
    else
    {
      throw new Error('invalid source descriptor entry');
    }
  }
  return code;
}

function _renderCss(nodes, dir)
{
  let result = '';
  for (const entry of nodes)
  {
    if (entry.modules !== undefined || typeof entry.file !== 'string' || entry.exports !== undefined || entry.imports !== undefined)
      throw new Error('invalid CSS descriptor entry');
    result += fs.readFileSync(_sourcePath(dir, entry.file), 'utf8') + '\n';
  }
  return result;
}

function _build(manifest)
{
  const file = path.resolve(manifest);
  const dir = path.dirname(file);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error('cannot read descriptor: ' + error.message); }
  if (!doc || !Array.isArray(doc.modules)) throw new Error('descriptor requires modules array');
  if (doc.nodeGlobal !== undefined && typeof doc.nodeGlobal !== 'boolean')
    throw new Error('nodeGlobal must be boolean');
  const types = new Set();
  _collectType(doc.modules, types);
  if (types.size !== 1 || !['.js','.css'].includes([...types][0]))
    throw new Error('source list must contain only JavaScript or only CSS');
  if (types.has('.css')) return {kind: 'css', code: _renderCss(doc.modules, dir)};
  const roots = doc.modules.filter(x => x.name !== undefined).map(x => x.name);
  const rootExport = roots.length === 1 ? `publicRoots.${roots[0]}` : 'publicRoots';
  const code = `(function (global)\n{\n'use strict';\n` +
    `var isNode = typeof module === 'object' && !!module.exports;\n` +
    `var shareGlobal = ${doc.nodeGlobal === true};\n` +
    `var publicRoots = {};\n` +
    `(function ()\n{\n${_renderNodes(doc.modules, dir)}\n}\n).call(publicRoots);\n` +
    `if (isNode) module.exports = ${rootExport};\n` +
    `else Object.assign(global, publicRoots);\n` +
    `}\n)(typeof globalThis === 'object' ? globalThis : this);\n`;
  new vm.Script(code, {filename: path.basename(file)});
  return {kind: 'js', code};
}

function _checkClosure(code)
{
  const availability = spawnSync('google-closure-compiler', ['--version'], {encoding: 'utf8'});
  if (availability.error?.code === 'ENOENT') return;
  if (availability.error || availability.status !== 0)
    throw new Error('Closure Compiler unavailable: ' + (availability.error?.message || availability.stderr));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm-jsc-'));
  try
  {
    const input = path.join(dir, 'source.js');
    fs.writeFileSync(input, code);
    const validation = spawnSync('google-closure-compiler', ['--checks_only','--js',input], {encoding: 'utf8'});
    if (validation.error || validation.status !== 0)
      throw new Error('Closure Compiler syntax check failed: ' + (validation.error?.message || validation.stderr || validation.stdout));
  }
  finally
  {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

async function jscMain(args)
{
  if (!Array.isArray(args) || args.length < 1 || args.length > 2 || args.some(a => typeof a !== 'string' || !a))
  {
    console.error('[error] [jsc.invalid-arguments] expected descriptor path and optional output path');
    return 1;
  }
  let result;
  try { result = _build(args[0]); }
  catch (error) { console.error('[error] [jsc.compile-failed] ' + error.message); return 2; }
  try { if (result.kind === 'js') _checkClosure(result.code); }
  catch (error) { console.error('[error] [jsc.syntax-check-failed] ' + error.message); return 3; }
  try
  {
    if (args.length === 1) process.stdout.write(result.code);
    else fs.writeFileSync(args[1], result.code);
  } catch (error) { console.error('[error] [jsc.output-failed] ' + error.message); return 4; }
  return 0;
}

module.exports = {jscMain};
if (require.main === module)
{
  jscMain(process.argv.slice(2)).then(status => { process.exitCode = status; });
}
