'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {audit} from '../../audit-rendered-dom-raw.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-068-raw-audit-'));
const cumulative = path.join(temp, 'cumulative');
const archive = path.join(temp, 'web-analyze');
fs.mkdirSync(cumulative);
fs.mkdirSync(path.join(archive, 'resources'), {recursive:true});

const flattened = [], names = new Map();
const add = item => (flattened.push(item), flattened.length-1);
function name(k) {
  if (!names.has(k)) names.set(k, add(k));
  return names.get(k);
}
function object(fields) {
  const result = {};
  for (const [k, v] of Object.entries(fields)) result['_'+name(k)] = v;
  return add(result);
}
function node(role, id, {final = false, hidden = false, recipient = 'all'} = {}) {
  const author = object({role:add(role)});
  const metadata = object({is_visually_hidden_from_conversation:add(hidden)});
  const message = object({id:add(id),author,recipient:add(recipient),
    end_turn:add(final),metadata});
  return object({message});
}
const nodes = [object({id:add('client-created-root')}),
  node('user', 'm-user'),
  node('system', 'm-system'),
  node('assistant', 'm-internal', {recipient:'tool'}),
  node('assistant', 'm-hidden', {final:true,hidden:true}),
  node('tool', 'm-tool'),
  node('assistant', 'm-final', {final:true})];
name('linear_conversation');
add(nodes);
const stream = JSON.stringify(flattened) + '\n';
const html = '<!doctype html><html><script>' +
  'window.__reactRouterContext.streamController.enqueue(' +
  JSON.stringify(stream) + ');</script></html>';
const bytes = Buffer.from(html);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const file = 'resources/'+digest+'.html';
fs.writeFileSync(path.join(archive, file), bytes);
fs.writeFileSync(path.join(archive, 'resources.jsonl'),JSON.stringify({
  status:'saved',resourceType:'Document',mimeType:'text/html',
  url:'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835',
  file,sha256:digest,bytes:bytes.length})+'\n');
const auditFile=path.join(cumulative,'audit.json');
const writeTurns = ids => fs.writeFileSync(auditFile,JSON.stringify({turns:
  ids.map((id,i)=>({ordinal:i+1,messageIds:[id]}))})+'\n');
try {
  writeTurns(['m-user','m-final']);
  const ok=audit(cumulative,archive);
  assert.equal(ok.status,'complete-visible-message-identity-and-order');
  assert.equal(ok.rawNodes,7);
  assert.deepEqual(ok.roles,{user:1,system:1,assistant:3,tool:1});
  assert.equal(ok.hiddenFinalAssistantMessages,1);
  assert.equal(ok.expectedVisibleMessages,2);
  assert.equal(ok.capturedDomMessages,2);
  assert.equal(ok.missingFromDomCount,0);
  assert.equal(ok.extraInDomCount,0);
  assert.equal(ok.orderMatches,true);
  assert.equal(ok.orderedVisibleIdSha256,ok.orderedDomIdSha256);
  assert.equal(ok.missingTurnOrdinalCount, 0);
  assert.equal(ok.assistantNodesWithoutFinalMarker, 1);
  assert.deepEqual(ok.visibilityWarnings, []);
  assert(!JSON.stringify(ok).includes('m-user'),'raw IDs should not leak in audit');

  // Matching message IDs cannot prove completeness when intermediate
  // conversation-turn ordinals have no captured HTML.
  fs.writeFileSync(auditFile, JSON.stringify({turns: [
    {ordinal: 1, messageIds: ['m-user']},
    {ordinal: 3, messageIds: ['m-final']}
  ]}) + '\n');
  const gap = audit(cumulative, archive);
  assert.equal(gap.status, 'inconclusive-visible-message-coverage');
  assert.equal(gap.missingTurnOrdinalCount, 1);
  assert.equal(gap.missingFromDomCount, 0);
  assert.equal(gap.extraInDomCount, 0);
  assert(gap.visibilityWarnings.some(reason => reason.includes('ordinals')));
  writeTurns(['m-final','m-user']);
  const wrongOrder=audit(cumulative,archive);
  assert.equal(wrongOrder.status,'raw-dom-mismatch');
  assert.equal(wrongOrder.orderMatches,false);
  assert.equal(wrongOrder.missingFromDomCount,0);
  writeTurns(['m-user']);
  const missing=audit(cumulative,archive);
  assert.equal(missing.missingFromDomCount,1);
  writeTurns(['m-user','m-extra']);
  const extra=audit(cumulative,archive);
  assert.equal(extra.missingFromDomCount,1);
  assert.equal(extra.extraInDomCount,1);
  writeTurns(['m-user','m-final']);
  fs.appendFileSync(path.join(archive,file),'modified');
  assert.throws(()=>audit(cumulative,archive),/SHA-256\/length verification/);

  // A generated-image-style conversation may have assistant nodes but no
  // end_turn=true assistant message. Matching only user IDs is inconclusive.
  const messageIdKey = '_' + names.get('id');
  const finalKey = '_' + names.get('end_turn');
  const finalIdIndex = flattened.indexOf('m-final');
  const finalMessage = flattened.find(item => item && !Array.isArray(item) &&
    typeof item === 'object' && item[messageIdKey] === finalIdIndex &&
    Object.hasOwn(item, finalKey));
  assert(finalMessage, 'fixture assistant final message not found');
  flattened[finalMessage[finalKey]] = false;
  const incompleteHtml = '<!doctype html><html><script>' +
    'window.__reactRouterContext.streamController.enqueue(' +
    JSON.stringify(JSON.stringify(flattened) + '\n') + ');</script></html>';
  const incompleteBytes = Buffer.from(incompleteHtml);
  const incompleteSha = crypto.createHash('sha256').update(incompleteBytes).digest('hex');
  const incompleteFile = 'resources/' + incompleteSha + '.html';
  fs.writeFileSync(path.join(archive, incompleteFile), incompleteBytes);
  fs.writeFileSync(path.join(archive, 'resources.jsonl'), JSON.stringify({
    status:'saved', resourceType:'Document', mimeType:'text/html',
    url:'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-8519-9e2d8c8097f3',
    file:incompleteFile, sha256:incompleteSha, bytes:incompleteBytes.length})+'\n');
  writeTurns(['m-user']);
  const noFinal = audit(cumulative, archive);
  assert.equal(noFinal.missingFromDomCount, 0);
  assert.equal(noFinal.extraInDomCount, 0);
  assert.equal(noFinal.expectedAssistantMessages, 0);
  assert.equal(noFinal.status, 'inconclusive-visible-message-coverage');
  assert(noFinal.visibilityWarnings.some(reason => reason.includes('no assistant reply')));
  console.log('PASS: RAW/DOM identity, missing ordinals, non-final assistant ambiguity, mismatches, integrity');
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
