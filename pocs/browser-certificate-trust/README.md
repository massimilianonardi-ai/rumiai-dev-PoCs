# TLS trust backends: Linux NSS and Node.js (exploratory)

Status: Experiment — not a current RumiAI contract or product implementation.
Date: 2026-10-19

## Question

Can a CA authorized by one source be projected into two **distinct existing** NSS databases without overwriting unrelated local trust entries, and can Node.js verify HTTPS with an additional PEM CA without disabling its normal TLS verification?

## Reproduce

On Linux with OpenSSL and NSS certutil, run: `sh tests/nss-projection.sh`.

For the Node.js TLS scenario, with Node.js and OpenSSL available, run: `node tests/node-extra-ca.mjs`.

The test creates disposable root certificates, imports one root into two separate NSS databases with a fingerprint-derived managed nickname, repeats synchronization, removes the authorized root, and verifies that a separate user-owned root remains untouched. All test materials are removed afterward.

The Node test starts a local HTTPS server with a temporary issuer, launches *separate* Node client processes and checks that the local server is rejected without the issuer, accepted with `NODE_EXTRA_CA_CERTS` pointing at its PEM and rejected again without it. It never sets a TLS verification-bypass variable.

## Observed result

On the ChatGPT auxiliary Linux environment on 2026-10-19 the equivalent local script reported:

`PASS: NSS CA projection, repeat sync, removal and unrelated-entry preservation`

On the ChatGPT auxiliary Linux environment on 2026-10-19, Node.js v22.16.0 and OpenSSL reported:

`PASS: Node TLS rejects untrusted CA; accepts additive PEM CA; rejects after removal`

This demonstrates Node.js process-startup PEM trust semantics and NSS database mechanics separately. It does **not** prove product integration, Node.js 26 behavior on all hosts, real Chromium/Electron HTTPS verification or production-ready reconciliation. A separate Chromium 144 headless TLS attempt terminated with `GPU process isn't usable` before verification.

## Unresolved before production

Authoritative CA registry and safe updates; certificate-content validation; concurrency, ownership and race protection; stale/tampered NSS entries; pre-existing database migration; package launch integration; macOS backend; running-process revocation; normal public CA baseline preservation; real end-to-end managed-client tests. Current scope/authority semantics are specified in rumiai-dev `TLS-TRUST.md`; these scripts are backend experiments, not product code.

Since Chromium M146, the default Linux NSS path is `$HOME/.local/share/pki/nssdb` with legacy `$HOME/.pki/nssdb` fallback. See https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md .

Do not run this PoC against an existing browser database or corporate trust store.
