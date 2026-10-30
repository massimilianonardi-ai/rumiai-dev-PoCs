'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {materializeSameSessionResources, renderSameSessionStyled}
  from '../render-same-session-styled.mjs';

const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function fixture(corrupt = false)
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc068-styled-test-'));
  const capture = path.join(root, 'capture');
  fs.mkdirSync(path.join(capture, 'static'), {recursive:true});
  fs.mkdirSync(path.join(capture, 'turns'));
  const css = Buffer.from('body{color:red}');
  const cssHash = hash(css);
  fs.writeFileSync(path.join(capture, 'static', cssHash + '.css'),
    corrupt ? Buffer.from('invalid') : css);
  const html = Buffer.from('<div data-turn-id-container="turn-test">' +
    '<div data-testid="conversation-turn-0"><div data-message-id="message-test">' +
    '<a href="https://openai.com/">OpenAI</a>' +
    '<table><tr><td>Cost</td></tr></table></div></div></div>');
  const htmlHash = hash(html);
  fs.writeFileSync(path.join(capture, 'turns', htmlHash + '.html'), html);
  const events = [
    {kind:'turn.snapshot',sequence:1,turnId:'turn-test',messageIds:['message-test'],
      sha256:htmlHash,bytes:html.length,file:'turns/' + htmlHash + '.html'},
    {kind:'network.static-body',sequence:2,status:'saved',resourceType:'Stylesheet',mimeType:'text/css',
      file:'static/' + cssHash + '.css',sha256:cssHash,bytes:css.length,
      originalUrl:'https://cdn.oaistatic.com/example.css'}
  ];
  fs.writeFileSync(path.join(capture, 'events.jsonl'),
    events.map(x => JSON.stringify(x)).join('\n') + '\n');
  return {root,capture};
}

test('localizes verified original CSS and keeps source links operable', () =>
{
  const {root,capture} = fixture();
  try
  {
    const out = path.join(root, 'styled');
    const result = renderSameSessionStyled(capture, out);
    assert.equal(result.resources.css, 1);
    assert.equal(result.capturedTurnCount, 1);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(html, /assets\/[a-f0-9]{64}\.css/);
    assert.ok(!html.includes('button,input,a{pointer-events:none}'));
    assert.ok(!html.includes('button,input{pointer-events:none}'));
    assert.match(html, /input\{pointer-events:none\}/);
    assert.ok(!html.includes('td,th{border:1px solid #bbb;padding:6px}'));
    assert.match(html, /<table><tr><td>Cost<\/td><\/tr><\/table>/);
    assert.match(html, /href="https:\/\/openai\.com\/"/);
    assert.match(html, /script-src 'none'/);
  }
  finally {fs.rmSync(root, {recursive:true,force:true});}
});

test('rejects corrupt static evidence before creating output', () =>
{
  const {root,capture} = fixture(true);
  try
  {
    const output = path.join(root, 'styled');
    assert.throws(() => renderSameSessionStyled(capture, output), /integrity/);
    assert.equal(fs.existsSync(output), false);
  }
  finally {fs.rmSync(root, {recursive:true,force:true});}
});

test('requires CSS bodies for original-style mode', () =>
{
  const {root,capture} = fixture();
  try
  {
    fs.writeFileSync(path.join(capture, 'events.jsonl'),
      fs.readFileSync(path.join(capture, 'events.jsonl'), 'utf8')
        .split(/\r?\n/).filter(Boolean)
        .filter(row => !row.includes('network.static-body')).join('\n') + '\n');
    assert.throws(() => materializeSameSessionResources(capture,
      path.join(root, 'archive')), /No verified original CSS/);
  }
  finally {fs.rmSync(root, {recursive:true,force:true});}
});


test('does not feed privately captured original Document HTML to CSS materializer',()=>{
  const {root,capture}=fixture();
  try
  {
    const body=Buffer.from('<!doctype html><title>ChatGPT - Example</title>');
    const digest=hash(body);
    fs.writeFileSync(path.join(capture,'static',digest+'.html'),body);
    const event={kind:'network.static-body',sequence:3,status:'saved',
      resourceType:'Document',mimeType:'text/html',
      file:'static/'+digest+'.html',sha256:digest,bytes:body.length,
      originalUrl:'https://chatgpt.com/share/example'};
    fs.appendFileSync(path.join(capture,'events.jsonl'),
      JSON.stringify(event)+'\n');
    const target=path.join(root,'archive');
    const result=materializeSameSessionResources(capture,target);
    assert.equal(result.css,1);
    assert.equal(result.distinctBodies,1);
    assert.doesNotMatch(fs.readFileSync(path.join(target,'resources.jsonl'),'utf8'),
      /text\/html/);
  }
  finally{fs.rmSync(root,{recursive:true,force:true});}
});
