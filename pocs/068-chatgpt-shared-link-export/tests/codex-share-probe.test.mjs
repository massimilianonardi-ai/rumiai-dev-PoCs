import test from 'node:test';
import assert from 'node:assert/strict';
import {validatedCodexShareUrl,inspectCodexShareHtml}
  from '../codex-share-probe.mjs';

const url='https://chatgpt.com/s/cx_6ae86b0755a08191a57b79dc77833361';
test('accepts only exact public Codex snapshot URL shape',()=>{
  assert.equal(validatedCodexShareUrl(url),url);
  for(const bad of ['http://chatgpt.com/s/cx_6ae86b0755a08191a57b79dc77833361',
    'https://evil.example/s/cx_6ae86b0755a08191a57b79dc77833361',
    url+'?token=secret',url+'#secret','https://chatgpt.com/s/',
    'https://chatgpt.com/s/cx_not-an-id',
    'https://chatgpt.com/share/6ae86b0755a08191a57b79dc77833361',
    'not an URL'])
    assert.throws(()=>validatedCodexShareUrl(bad));
});

test('recognizes access-control challenge without exposing page content',()=>{
  const html='<html><head><title>Just a moment...</title></head><body>'+
    '<h1>Just a moment...</h1>'+
    '<script src="https://challenges.cloudflare.com/x.js"></script>'+
    '<p>internal token = secret123</p></body></html>';
  const result=inspectCodexShareHtml(html);
  assert.equal(result.status,'not-captured');
  assert.ok(result.reasons.includes('cloudflare-challenge'));
  assert.equal(result.completenessVerified,false);
  assert.equal(JSON.stringify(result).includes('secret123'),false);
});

test('observed Codex-like DOM is only a candidate, not an export PASS',()=>{
  const html='<html><head><title>Example Thread</title>'+
    '<meta name="viewport" content="width=device-width"></head>'+
    '<body><main><h1>Example Thread</h1>'+
    '<article data-testid="thread-entry"><time datetime="2026-10-12T10:00:00Z"></time>'+
    '<p>'+'a'.repeat(260)+'</p><pre><code>hello</code></pre>'+
    '</article></main></body></html>';
  const result=inspectCodexShareHtml(html);
  assert.equal(result.status,'rendered-candidate-unverified');
  assert.deepEqual(result.reasons,[]);
  assert.equal(result.counts.article,1);
  assert.equal(result.counts.code,1);
  assert.equal(result.counts.datetime,1);
  assert.equal(result.counts.testid,1);
  assert.equal(result.originalTitleVerified,false);
  assert.equal(result.firstMessageDateVerified,false);
  assert.equal(result.completenessVerified,false);
  assert.equal(JSON.stringify(result).includes('hello'),false);
});

test('empty or generic pages are never confused with a conversation',()=>{
  for(const html of ['', '<html><body><main>Loading...</main></body></html>',
    '<html><body>Sign in</body></html>'])
  {
    const result=inspectCodexShareHtml(html);
    assert.equal(result.status,'not-captured');
  }
});
