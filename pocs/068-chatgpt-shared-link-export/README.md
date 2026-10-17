# PoC 068 — retired ChatGPT export experiments

**Status: closed and removed from the active implementation tree.** Direct human inspection rejected the readable HTML/Markdown/PDF publications and the subsequent generic browser-observation/viewer experiments. The repository history retains all earlier code, evidence, authorized captures and commits without rewriting or force-pushing anything. Those past artifacts **must not be treated as successful full-fidelity exports**.

The user explicitly requested a clean restart instead of further patches. Consequently all previously tracked code, tests, generated captures and archive outputs belonging to PoC 068 have been removed from the current branch, leaving only this record. The previous physical tests established limited structured/public-media acquisition milestones, **not** faithful end-user rendering or complete chronology.

The new generic browser-page investigation is [PoC 069](../069-web-page-analyze/README.md). **No code or architecture has been carried over**. It starts by measuring native Chromium page-save behavior and observing actual human interaction sequences (including scroll direction, not just scroll coverage).

**Important local boundary:** files ignored by Git, including private evidence directories in the user's VM, are not remotely accessible and were not removed. Removing them must not be conflated with the Git cleanup. Browser-managed runtime IPC/desktop portal internals cannot be deleted by a repository commit; what is removed is all PoC code that opened or exposed those aliases as output paths.
