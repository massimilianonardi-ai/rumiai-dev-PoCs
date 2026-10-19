#!/bin/sh
# Exploratory evidence only: NSS trust projection, not browser HTTPS behavior.
set -eu

command -v certutil >/dev/null 2>&1 || { printf '%s\n' 'SKIP: certutil missing'; exit 2; }
command -v openssl >/dev/null 2>&1 || { printf '%s\n' 'SKIP: openssl missing'; exit 2; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-nss-projection.XXXXXXXX")
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM
mkdir -p -- "$tmp/authoritative" "$tmp/browser-a" "$tmp/browser-b" "$tmp/unrelated"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$tmp/root.key" -out "$tmp/authoritative/root.pem" \
  -subj '/CN=RumiAI temporary test CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$tmp/unrelated.key" -out "$tmp/unrelated/root.pem" \
  -subj '/CN=Separate temporary test CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1

for db in browser-a browser-b
do
  certutil -N --empty-password -d "sql:$tmp/$db" >/dev/null 2>&1
done

# Existing user-managed data in browser B is not owned by the projection.
certutil -A -d "sql:$tmp/browser-b" -n external-ca -t 'C,,' -i "$tmp/unrelated/root.pem"

fingerprint=$(openssl x509 -in "$tmp/authoritative/root.pem" -outform DER | openssl dgst -sha256 -r)
fingerprint=${fingerprint%% *}
nickname="rumiai-ca-$fingerprint"

# Trial implementation of a projection with an explicit owned-entry manifest.
# It does not read, replace or attempt to migrate third-party NSS entries.
sync_nss()
{
  db=$1
  desired=$tmp/desired
  : > "$desired"
  if [ -f "$tmp/authoritative/root.pem" ]
  then
    printf '%s\n' "$nickname" > "$desired"
  fi
  if [ -f "$db/rumiai-owned-nicknames" ]
  then
    while IFS= read -r old
    do
      [ -n "$old" ] || continue
      if ! grep -Fqx -- "$old" "$desired"
      then
        certutil -D -d "sql:$db" -n "$old"
      fi
    done < "$db/rumiai-owned-nicknames"
  fi
  if [ -s "$desired" ]
  then
    if ! certutil -L -d "sql:$db" -n "$nickname" >/dev/null 2>&1
    then
      certutil -A -d "sql:$db" -n "$nickname" -t 'C,,' -i "$tmp/authoritative/root.pem"
    fi
  fi
  cp -- "$desired" "$db/rumiai-owned-nicknames"
}

assert_absent()
{
  if certutil -L -d "sql:$1" -n "$2" >/dev/null 2>&1
  then
    printf 'FAIL: unexpected certificate: %s in %s\n' "$2" "$1" >&2
    exit 1
  fi
}

assert_present()
{
  if ! certutil -L -d "sql:$1" -n "$2" >/dev/null 2>&1
  then
    printf 'FAIL: missing certificate: %s in %s\n' "$2" "$1" >&2
    exit 1
  fi
}

assert_absent "$tmp/browser-a" "$nickname"
assert_absent "$tmp/browser-b" "$nickname"
sync_nss "$tmp/browser-a"
sync_nss "$tmp/browser-b"
sync_nss "$tmp/browser-b" # Repeat synchronization is idempotent.
assert_present "$tmp/browser-a" "$nickname"
assert_present "$tmp/browser-b" "$nickname"
assert_present "$tmp/browser-b" external-ca

rm -- "$tmp/authoritative/root.pem"
sync_nss "$tmp/browser-a"
sync_nss "$tmp/browser-b"
assert_absent "$tmp/browser-a" "$nickname"
assert_absent "$tmp/browser-b" "$nickname"
assert_present "$tmp/browser-b" external-ca
printf '%s\n' 'PASS: NSS CA projection, repeat sync, removal and unrelated-entry preservation'
