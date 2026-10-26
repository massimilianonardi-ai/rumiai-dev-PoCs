# PoC 074 — jsc package-local runtime

Status: Experimental. This is not a new published jsc source repository,
package definition, or downloadable release.

## Purpose

Test whether the existing `rumiai-os` technical `jsc` compiler can be
distributed as its own package, with the original POSIX command, the
original unmodified CommonJS engine, and its own manual resources all
located beneath `root/`. The POSIX entrypoint must load the existing
`m` core and locate the sibling `lib/jsc.lib.js` relative to its
physical command location, not through `m/lib/sys/js`.

The source comes from unchanged `rumiai-os/main@673df1a2d5476ad57d54c7bc7e1fc2deeaf16195`. The only
command change is package-relative engine lookup and a distinct
command-path/engine-presence failure check. This PoC does not modify
`rumiai-os`, `rumiai-tests`, `m`, or `pkg-catalog`.

`nodejs =26` is the runtime dependency. Packaging is a POSIX file
copy/archive step and does not require Node.js, `mk` or compilation.

## Verify

```sh
sh tests/run.sh /path/to/m-checkout
```

The integration scenario clones a standalone `m` checkout into an isolated
temporary root, builds the package payload, installs it through the real
`pkg_integrate` and `pkg_default_apply` functions with a local test-only
descriptor, then installs real managed Node.js and executes the public
`m jsc` launcher to generate JavaScript and CSS outputs.

If this passes, extract the source to a dedicated repository, publish a
versioned verifiable release, and only then add a real `pkg-catalog`
descriptor and validate `pkg install jsc` publicly. Do not register this
local descriptor as an upstream release.
