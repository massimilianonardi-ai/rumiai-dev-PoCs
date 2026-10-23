#!/bin/sh
set -eu

: "${WORK:?WORK is required}"
: "${M_REPO:?M_REPO is required}"
: "${PKG_REPO:?PKG_REPO is required}"
: "${LANG_REPO:?LANG_REPO is required}"
: "${M_SHA:?M_SHA is required}"
: "${PKG_SHA:?PKG_SHA is required}"
: "${LANG_SHA:?LANG_SHA is required}"

source_dir="$WORK/posix/sources"
stage="$WORK/posix/stage"
output="$WORK/out-posix"
[ ! -e "$output" ] || { printf '%s\n' 'POSIX output already exists' >&2; exit 1; }
mkdir -p "$source_dir" "$stage/bin/sys" "$stage/res/sys/lang" "$stage/pkg"

git clone -q -- "$M_REPO" "$source_dir/m"
git -C "$source_dir/m" checkout -q --detach "$M_SHA"
git clone -q -- "$PKG_REPO" "$source_dir/pkg"
git -C "$source_dir/pkg" checkout -q --detach "$PKG_SHA"
git clone -q -- "$LANG_REPO" "$source_dir/lang"
git -C "$source_dir/lang" checkout -q --detach "$LANG_SHA"

cat "$source_dir/m/bootstrap.head.sh" \
    "$source_dir/pkg/bootstrap.env.sh" \
    "$source_dir/lang/bootstrap.env.sh" \
    "$source_dir/m/bootstrap.tail.sh" > "$stage/m"

cp "$source_dir/pkg/bin/sys/pkg-root" "$stage/bin/sys/pkg-root"
cp "$source_dir/lang/bin/sys/lang-root" "$stage/bin/sys/lang-root"
chmod 755 "$stage/m" "$stage/bin/sys/pkg-root" "$stage/bin/sys/lang-root"

cp -R "$source_dir/lang/res/sys/lang/en_US" "$stage/res/sys/lang/"
cp -R "$source_dir/lang/res/sys/lang/it_IT" "$stage/res/sys/lang/"
ln -s en_US "$stage/res/sys/lang/current"

mv "$stage" "$output"
