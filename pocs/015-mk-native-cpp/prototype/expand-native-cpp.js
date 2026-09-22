'use strict';

const fs = require('fs');
const path = require('path');

function fail(message) {
  process.stderr.write(`expand-native-cpp: ${message}\n`);
  process.exit(1);
}

function relativePortable(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function operationToken(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

function discover(root, extensions) {
  const result = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, {withFileTypes: true})
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && extensions.some(extension => entry.name.endsWith(extension))) {
        result.push(absolute);
      }
    }
  }

  visit(root);
  return result;
}

function readConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'project.experimental.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`cannot read experimental descriptor: ${error.message}`);
  }

  for (const key of ['sourceRoot', 'objectRoot', 'output', 'compiler']) {
    if (typeof config[key] !== 'string' || config[key].length === 0) {
      fail(`invalid ${key}`);
    }
  }
  if (!Array.isArray(config.extensions) || config.extensions.length === 0 ||
      config.extensions.some(value => typeof value !== 'string' || value.length === 0)) {
    fail('invalid extensions');
  }
  if (!Array.isArray(config.includeDirs) || config.includeDirs.some(value => typeof value !== 'string')) {
    fail('invalid includeDirs');
  }
  if (!Array.isArray(config.flags) || config.flags.some(value => typeof value !== 'string')) {
    fail('invalid flags');
  }
  return config;
}

function main(argv) {
  if (argv.length !== 1) {
    fail('usage: expand-native-cpp.js <project-root>');
  }

  const projectRoot = fs.realpathSync(argv[0]);
  const config = readConfig(projectRoot);
  const sourceRootAbsolute = path.resolve(projectRoot, config.sourceRoot);
  const sources = discover(sourceRootAbsolute, config.extensions)
    .map(absolute => relativePortable(projectRoot, absolute))
    .sort();

  if (sources.length === 0) {
    fail('no sources discovered');
  }

  const operations = {};
  const directoryOperations = new Map();
  const compileNames = [];
  const objectPaths = [];

  function ensureDirectory(relativeDirectory) {
    if (directoryOperations.has(relativeDirectory)) {
      return directoryOperations.get(relativeDirectory);
    }
    const name = `mkdir-${operationToken(relativeDirectory)}`;
    directoryOperations.set(relativeDirectory, name);
    operations[name] = {
      action: {
        type: 'process',
        command: 'mkdir',
        args: ['-p', relativeDirectory]
      }
    };
    return name;
  }

  const outputDirectory = path.posix.dirname(config.output);
  const outputDirectoryOperation = ensureDirectory(outputDirectory);

  for (const source of sources) {
    const sourceBelowRoot = path.posix.relative(config.sourceRoot, source);
    const objectPath = path.posix.join(config.objectRoot, `${sourceBelowRoot}.o`);
    const objectDirectory = path.posix.dirname(objectPath);
    const directoryOperation = ensureDirectory(objectDirectory);
    const compileName = `compile-${operationToken(source)}`;

    const includeArgs = config.includeDirs.map(directory => `-I${directory}`);
    operations[compileName] = {
      prerequisites: [directoryOperation],
      action: {
        type: 'process',
        command: config.compiler,
        args: [
          ...config.flags,
          ...includeArgs,
          '-c',
          source,
          '-o',
          objectPath
        ]
      }
    };
    compileNames.push(compileName);
    objectPaths.push(objectPath);
  }

  operations.link = {
    prerequisites: [outputDirectoryOperation, ...compileNames],
    action: {
      type: 'process',
      command: config.compiler,
      args: [
        ...objectPaths,
        '-o',
        config.output
      ]
    }
  };

  const generated = {
    version: 1,
    goals: {
      build: ['link']
    },
    operations
  };

  fs.writeFileSync(
    path.join(projectRoot, 'mk.json'),
    `${JSON.stringify(generated, null, 2)}\n`,
    'utf8'
  );
}

main(process.argv.slice(2));
