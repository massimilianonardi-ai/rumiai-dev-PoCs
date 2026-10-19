#!/usr/bin/env node
// Isolated experiment: a managed PEM CA extends Node TLS trust without disabling verification.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const directory = mkdtempSync(path.join(os.tmpdir(), 'm-tls-node-'));
const openssl = (...args) =>
{
  const run = spawnSync('openssl', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(run.status, 0, `openssl ${args[0]} failed: ${run.stderr}`);
};

function runClient(port, extraCA)
{
  const script = `
    const https = require('node:https');
    https.get('https://localhost:' + process.argv[1] + '/',
      { family: 4 },
      response => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => process.exit(body === 'TLS_OK' ? 0 : 4));
      }).on('error', error => {
        console.error(error.code || error.message);
        process.exit(3);
      });
  `;
  const env = { ...process.env };
  delete env.NODE_EXTRA_CA_CERTS;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete env.NODE_USE_SYSTEM_CA;
  if (extraCA) env.NODE_EXTRA_CA_CERTS = extraCA;
  return spawnSync(process.execPath, ['-e', script, String(port)],
    { env, encoding: 'utf8', timeout: 6000 });
}

async function main()
{
  writeFileSync(path.join(directory, 'leaf.ext'),
    'subjectAltName=DNS:localhost\nbasicConstraints=critical,CA:FALSE\n' +
    'keyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', 'root.key', '-out', 'root.pem', '-subj', '/CN=RumiAI test root',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key',
    '-out', 'leaf.csr', '-subj', '/CN=localhost');
  openssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem',
    '-CAkey', 'root.key', '-CAcreateserial', '-days', '1',
    '-out', 'leaf.pem', '-extfile', 'leaf.ext');

  // Node reads NODE_EXTRA_CA_CERTS at process startup.
  const service = spawn(process.execPath, ['-e', `
    const https = require('node:https');
    const fs = require('node:fs');
    const server = https.createServer(
      { key: fs.readFileSync(process.argv[1]),
        cert: fs.readFileSync(process.argv[2]) },
      (_, response) => response.end('TLS_OK'));
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `, path.join(directory, 'leaf.key'), path.join(directory, 'leaf.pem')],
  { stdio: ['ignore', 'pipe', 'inherit'] });

  try
  {
    const port = await new Promise((resolve, reject) =>
    {
      let data = '';
      service.once('error', reject);
      service.stdout.on('data', chunk =>
      {
        data += chunk;
        if (data.includes('\n')) resolve(Number(data.trim()));
      });
      service.once('exit', () => reject(new Error('test HTTPS server exited')));
    });
    const before = runClient(port, null);
    assert.equal(before.status, 3, `expected verification rejection, got ${before.status}: ${before.stderr}`);
    assert.match(before.stderr, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);
    const trusted = runClient(port, path.join(directory, 'root.pem'));
    assert.equal(trusted.status, 0, `expected trusted TLS handshake: ${trusted.stderr}`);
    const after = runClient(port, null);
    assert.equal(after.status, 3, `expected verification rejection after removal: ${after.stderr}`);
    console.log('PASS: Node TLS rejects untrusted CA; accepts additive PEM CA; rejects after removal');
  }
  finally
  {
    service.kill('SIGTERM');
    await new Promise(resolve => service.once('exit', resolve));
  }
}

try
{
  await main();
}
finally
{
  rmSync(directory, { recursive: true, force: true });
}
