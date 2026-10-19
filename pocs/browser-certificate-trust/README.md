# Linux NSS browser CA projection (exploratory)

Status: Experiment — not a current RumiAI contract or product implementation.
Date: 2026-10-19

## Question

Can one authorized CA certificate be projected into two **distinct existing** NSS databases and later removed without overwriting unrelated local trust entries?

## Reproduce

On Linux with OpenSSL and NSS certutil, run: `sh tests/nss-projection.sh`.

The test creates disposable root certificates, imports one root into two separate NSS databases with a fingerprint-derived managed nickname, repeats synchronization, removes the authorized root, and verifies that a separate user-owned root remains untouched. All test materials are removed afterward.

## Observed result

On the ChatGPT auxiliary Linux environment on 2026-10-19 the equivalent local script reported:

`PASS: NSS CA projection, repeat sync, removal and unrelated-entry preservation`

This proves NSS command-line database mechanics in the tested environment, **not** real Chromium/Electron HTTPS verification or production-ready reconciliation. A separate Chromium 144 headless TLS attempt terminated with `GPU process isn't usable` before verification.

## Unresolved before production

Authoritative CA registry and safe updates; certificate-content validation; concurrency, ownership and race protection; stale/tampered NSS entries; pre-existing database migration; package launch integration; account and service scope; macOS backend; running-browser revocation; real end-to-end trust, rejection and revocation tests.

Since Chromium M146, the default Linux NSS path is `$HOME/.local/share/pki/nssdb` with legacy `$HOME/.pki/nssdb` fallback. See https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md .

Do not run this PoC against an existing browser database or corporate trust store.
