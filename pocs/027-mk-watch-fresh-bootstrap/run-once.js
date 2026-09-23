'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message, status = 1) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function main() {
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  const project = process.env.POC027_PROJECT;
  if (typeof target !== 'string' || target.length === 0) fail('RUMIAI_POC_RUMIAI_OS is required', 2);
  if (typeof project !== 'string' || project.length === 0) fail('POC027_PROJECT is required', 2);

  const targetRoot = fs.realpathSync(target);
  const projectRoot = fs.realpathSync(project);
  process.env.m_ROOT = targetRoot;

  const {mkMain} = require(path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js'));
  return mkMain(['--project', projectRoot, 'build']);
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`run-once: ${error && error.message ? error.message : 'unexpected failure'}\n`);
  process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
}
