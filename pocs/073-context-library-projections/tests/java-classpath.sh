#!/bin/sh
# Experimental Java library projection. Does not depend on RumiAI runtime.
set -eu
for tool in java javac jar mktemp ln mkdir; do command -v "$tool" >/dev/null; done
root=$(mktemp -d)
trap 'rm -rf "$root"' 0
mkdir -p "$root/versions/a/demo" "$root/versions/b/demo" \
  "$root/classes/a" "$root/classes/b" "$root/classes/consumer" \
  "$root/views/a" "$root/views/b"
printf '%s\n' 'package demo; public class Shared { public static String version(){ return "A"; } }' > "$root/versions/a/demo/Shared.java"
printf '%s\n' 'package demo; public class Shared { public static String version(){ return "B"; } }' > "$root/versions/b/demo/Shared.java"
printf '%s\n' 'import demo.Shared; public class Consumer { public static void main(String[] args){ System.out.print(Shared.version()); } }' > "$root/Consumer.java"
javac -d "$root/classes/a" "$root/versions/a/demo/Shared.java"
javac -d "$root/classes/b" "$root/versions/b/demo/Shared.java"
jar cf "$root/versions/a/shared.jar" -C "$root/classes/a" .
jar cf "$root/versions/b/shared.jar" -C "$root/classes/b" .
javac -cp "$root/versions/a/shared.jar" -d "$root/classes/consumer" "$root/Consumer.java"
ln -s "$root/versions/a/shared.jar" "$root/views/a/shared.jar"
ln -s "$root/versions/b/shared.jar" "$root/views/b/shared.jar"
run_consumer()
{
  CLASSPATH="$1/*:$root/classes/consumer" java Consumer
}
a=$(run_consumer "$root/views/a")
b=$(run_consumer "$root/views/b")
a2=$(run_consumer "$root/views/a")
[ "$a" = A ] && [ "$b" = B ] && [ "$a2" = A ]
# An explicit -cp replaces the CLASSPATH environment variable.
if CLASSPATH="$root/views/a/*:$root/classes/consumer" java -cp "$root/classes/consumer" Consumer > "$root/explicit.out" 2> "$root/explicit.err"
then
  echo 'FAIL: explicit -cp unexpectedly inherited CLASSPATH libraries' >&2
  exit 1
fi
first=$(CLASSPATH="$root/views/a/*:$root/views/b/*:$root/classes/consumer" java Consumer)
second=$(CLASSPATH="$root/views/b/*:$root/views/a/*:$root/classes/consumer" java Consumer)
[ "$first" = A ] && [ "$second" = B ]
printf '%s\n' 'PASS: JAR symlink projections A/B/A; left-to-right precedence A/B; explicit -cp overrides CLASSPATH'
