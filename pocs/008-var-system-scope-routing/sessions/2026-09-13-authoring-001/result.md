# PoC 008 authoring session result

Date: 2026-09-13  
Environment: Linux x86_64 authoring container  
Scope: isolated filesystem semantics only

## Command

```sh
sh pocs/008-var-system-scope-routing/tests/run
```

## Result

```text
var-system-routing=PASS
native-user-routing=PASS
var-never-user=PASS
profile-switch=PASS
native-no-var=PASS
var-system-scope-model=PASS
```

Overall result: **PASS**.

## Observation discovered during authoring

An earlier experimental form attempted to replace the directory-targeting symlink `state/system/current` directly with:

```text
mv current.new current
```

while `current` still existed.

On the authoring host this did not replace the selector entry as intended: the destination symlink was treated as referring to a directory. The profile switch assertion consequently failed.

The PoC was corrected to perform the selector switch only while quiescent by removing the old selector before moving the prepared replacement into place.

This observation does not invalidate `var/ -> state/system/current/...` routing. It shows instead that the future profile-selector contract must separately define a portable replacement/recovery mechanism if atomic replacement is required.

## Conclusion

The tested filesystem model supports all of the following simultaneously:

```text
one shared immutable package installation
static package-local var routing to system state
system-profile selection behind that routing
independent native-routed user state for two principals
no var routing into user state
```

No dynamic per-user `var/` mechanism was required.

This session is PoC evidence only. It is not permanent validation of a product revision.
