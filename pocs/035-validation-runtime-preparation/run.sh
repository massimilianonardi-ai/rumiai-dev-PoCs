#!/bin/sh
set -eu

fail()
{
  printf '%s\n' "FAIL $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: $0 <rumiai-os-source>"

source_root=$1
[ -d "$source_root/.git" ] || fail "source is not a git checkout"
source_root="$(CDPATH= cd -- "$source_root" && pwd -P)"
product_commit="$(git -C "$source_root" rev-parse --verify HEAD)" || fail "cannot resolve product commit"
product_origin="$(git -C "$source_root" remote get-url origin)" || fail "cannot resolve product origin"

tmp="${TMPDIR:-/tmp}/rumiai-poc-035-$$"
trap 'rm -rf -- "$tmp"' 0 HUP INT TERM
mkdir -p "$tmp/home/.config" "$tmp/home/.cache" "$tmp/home/.local/share" "$tmp/home/.local/state" "$tmp/tmp" "$tmp/runtime"

target="$tmp/target"
git clone --no-local --no-checkout -q -- "$source_root" "$target" || fail "cannot clone source"
git -C "$target" checkout -q --detach "$product_commit" || fail "cannot checkout exact product commit"
git -C "$target" remote set-url origin "$product_origin" || fail "cannot restore product origin"

(
  HOME="$tmp/home"
  TMPDIR="$tmp/tmp"
  TMP="$tmp/tmp"
  TEMP="$tmp/tmp"
  XDG_CONFIG_HOME="$tmp/home/.config"
  XDG_CACHE_HOME="$tmp/home/.cache"
  XDG_DATA_HOME="$tmp/home/.local/share"
  XDG_STATE_HOME="$tmp/home/.local/state"
  XDG_RUNTIME_DIR="$tmp/runtime"
  export HOME TMPDIR TMP TEMP XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_RUNTIME_DIR

  cd "$target"

  install_ok=0
  install_try=0
  while [ "$install_try" -lt 3 ]
  do
    install_try=$((install_try + 1))
    if ./m ./bin/sys/pkg install nodejs
    then
      install_ok=1
      break
    fi
    [ "$install_try" -lt 3 ] || break
    sleep 5
  done
  [ "$install_ok" -eq 1 ] || fail "managed nodejs installation failed"

  ./m ./bin/sys/pkg default nodejs || fail "managed nodejs default selection failed"

  node_version="$(./m node --version)" || fail "managed node execution failed"

  managed_node=
  for candidate in "$target"/bin/ext/node "$target"/bin/ext-*/node
  do
    [ -e "$candidate" ] || [ -L "$candidate" ] || continue
    managed_node=$candidate
    break
  done
  [ -n "$managed_node" ] || fail "managed node integration link not found in disposable target"

  cache_root="$(./m ./bin/sys/state-path system sys pkg cache)" || fail "cannot resolve package cache"
  catalog="$cache_root/pkg-catalog"
  [ -d "$catalog/.git" ] || fail "package catalog cache missing"
  catalog_commit="$(git -C "$catalog" rev-parse --verify HEAD)" || fail "cannot resolve catalog commit"
  case "$catalog_commit" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
    *) fail "invalid catalog commit: $catalog_commit" ;;
  esac

  printf '%s\n' "product-commit=$product_commit"
  printf '%s\n' "catalog-commit=$catalog_commit"
  printf '%s\n' "managed-node=$managed_node"
  printf '%s\n' "node-version=$node_version"
  printf '%s\n' "PASS validation target runtime preparation"
)
