#!/bin/sh
# Add one bounded uncompressed CPIO overlay AFTER original vendor zstd initrd.
# Never repacks or changes the vendor initrd bytes. Inspect vendor files as
# DATA on the host; execute original vendor /init only in isolated guest.
set -eu
[ "$#" -eq 2 ] || {
  echo 'usage: make_append_only_probe.sh VENDOR_INITRD NEW_OUTPUT_DIR' >&2
  exit 2
}
source=$1
output=$2
[ -s "$source" ] && [ ! -e "$output" ] || exit 3
for cmd in python3 zstd cpio fakeroot unmkinitramfs sha256sum cmp; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing probe dependency: $cmd" >&2
    exit 4
  }
done
mkdir -p "$output" "$output/root" "$output/extracted"
output=$(CDPATH= cd "$output" && pwd -P)
source=$(realpath "$source")
orig=$(sha256sum "$source" | awk '{print $1}')
python3 - "$source" <<'PY'
import sys
with open(sys.argv[1], "rb") as f:
    assert f.read(4) == b"\x28\xb5\x2f\xfd", "vendor initramfs not zstd"
PY
zstd -t "$source"
fakeroot -- unmkinitramfs "$source" "$output/extracted" \
  > "$output/unmkinitramfs.log" 2>&1
test -s "$output/extracted/init" || {
  echo 'Original vendor init absent (not an assumed entrypoint)' >&2
  exit 5
}
cp "$output/extracted/init" "$output/root/rumiai-original-init"
chmod 755 "$output/root/rumiai-original-init"
cat > "$output/root/init" <<'EOF'
#!/bin/sh
# This file exists only in a TEMPORARY appended newc archive.
# Original vendor initramfs and source ISO remain byte-identical.
exec </dev/console >/dev/console 2>&1
echo VT085_APPENDED_CPIO_INIT_EXECUTED
if [ ! -s /rumiai-original-init ]; then
  echo VT085_ORIGINAL_INIT_MISSING
  exit 88
fi
echo VT085_EXEC_ORIGINAL_VENDOR_INIT
exec /bin/sh /rumiai-original-init "$@"
EOF
chmod 755 "$output/root/init"
(cd "$output/root" && find . -type f -print | LC_ALL=C sort | \
 cpio -o -H newc 2> "$output/cpio.log") \
 > "$output/append-only-hook.cpio"
[ "$(wc -c < "$output/append-only-hook.cpio")" -lt 65536 ] || {
  echo 'Experimental appended CPIO exceeds 64KiB' >&2
  exit 6
}
# Linux's initramfs stream parser expects a new cpio archive to start at
# a 4-byte boundary. Both exact vendor .zst lengths are 1 modulo 4.
# Preserve every original byte; insert 0..3 external alignment bytes.
python3 - "$source" "$output/append-only-hook.cpio" \
  "$output/composed-initrd.img" <<'PYPAD'
from pathlib import Path
import sys
original = Path(sys.argv[1]).read_bytes()
sidecar = Path(sys.argv[2]).read_bytes()
pad = (-len(original)) % 4
assert sidecar.startswith(b'070701'), 'unexpected cpio header'
Path(sys.argv[3]).write_bytes(original + b'\0' * pad + sidecar)
print(f'VT085_CPIO_4_BYTE_ALIGNMENT_PAD={pad}')
PYPAD
test "$(wc -c < "$output/composed-initrd.img")" -eq \
  "$(($(wc -c < "$source") + (4 - $(wc -c < "$source") % 4) % 4 + $(wc -c < "$output/append-only-hook.cpio")))" ||
  exit 7
python3 - "$source" "$output/composed-initrd.img" <<'PY'
import hashlib
import sys
with open(sys.argv[1], "rb") as orig, open(sys.argv[2], "rb") as composed:
    h = hashlib.sha256()
    while True:
        part = orig.read(1024 * 1024)
        if not part:
            break
        h.update(part)
        assert composed.read(len(part)) == part, "vendor original prefix changed"
    print("VT085_ORIGINAL_VENDOR_INITRD_PREFIX_IDENTITY_PASS " + h.hexdigest())
PY
test "$orig" = "$(sha256sum "$source" | awk '{print $1}')" || exit 8
sha256sum "$source" "$output/append-only-hook.cpio" \
  "$output/composed-initrd.img" > "$output/sha256sums.txt"
echo "VT085_COMPOSED_INITRD_READY original_sha256=$orig extra_bytes=$(wc -c < "$output/append-only-hook.cpio")"
