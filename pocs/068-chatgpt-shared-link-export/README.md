# PoC 068 — ChatGPT shared-link structured capture (retired experiment)

**Status: not accepted for readable export.** The visual HTML, Markdown, PDF publication and the subsequent generic browser replay experiment were explicitly rejected after direct human inspection. Their application code, local viewing workaround and active test entrypoints have been removed from the current tree. Their previous commits remain available in forward-only Git history; those results **are not validation evidence for a successful exporter**.

## What remains, and why

This PoC retains the original **structured, site-specific acquisition prototype** and its experimental tests only as an independent research artifact. The earlier physical PWC run established retrieval of public assistant-generated images and sandbox files on a small set of authorized ChatGPT shared links. It **did not establish** visual fidelity, complete user dialogue recovery, layout preservation, thinking fidelity, or general web-page export. No current CLI from this PoC should be presented as a validated readable exporter.

The older `published-reference-chats/` and `chronological-reference-chats/` directories, where tracked, are **rejected samples**, not reference-quality output. They remain temporarily as original historical evidence; do not regenerate, overwrite, publish further, or use them as proof of fidelity. Private/untracked evidence in `experiments/evidence/` on the physical VM is outside GitHub control: it is deliberately ignored and has **not** been deleted or inspected remotely.

## Current experimental direction

The new generic web-page observation problem is pursued separately in [PoC 069](../069-web-page-analyze/README.md), starting with **no inherited recorder, replay algorithm, HTML rewrite, local viewer or CSS reconstruction code**. The existing independent `web-control` provider remains unchanged.

Browser observation must not silently replace a demonstrated `bottom → top` traversal with `top → bottom`. Treat user events as source observations and infer explicit intents with direction, target scroll container and boundaries; replay independently and compare against observed states before claiming learned behavior.

Do not confuse `page.content()` (current DOM serialization, with potentially absolute live resource URLs) with a browser **Save Page, Complete** export. A native browser MHTML snapshot is also a different archive format. No code here currently establishes a faithful offline complete-page export. Browser/desktop-opening aliases are not an acceptable persistent output contract.

## Engineering status

This directory is **not the active generic web-page-analysis experiment**. Its remaining acquisition sources/tests may be consulted as historical mechanical evidence, but must not impose architecture on the new PoC. No new physical browser run or validation has been performed after this cleanup.
