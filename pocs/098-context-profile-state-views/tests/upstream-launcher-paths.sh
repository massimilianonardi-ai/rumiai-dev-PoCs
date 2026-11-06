#!/bin/sh
# PoC 098: exercise exact tagged upstream shell launchers without server/JVM.
# Inputs are GeoServer 3.0.1 startup.sh and Keycloak 26.7.3 kc.sh.
set -eu

fail()
{
  printf '%s\n' "FAIL: $1" >&2
  exit 1
}

[ "$#" -eq 2 ] && [ -f "$1" ] && [ -f "$2" ] ||
  fail 'expected exact tagged GeoServer and Keycloak launcher scripts'
geoserver_source=$1
keycloak_source=$2

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-c2-launch-XXXXXX") ||
  fail 'cannot prepare disposable launcher tree'
trap 'rm -rf "$work"' 0
trap 'exit 1' 1 2 3 15

mkdir -p "$work/stub" "$work/geoserver/bin" "$work/geoserver/webapps" \
  "$work/geoserver/data_dir" "$work/keycloak/bin" \
  "$work/keycloak/conf" "$work/keycloak/lib" \
  "$work/profiles/a/geodata" "$work/profiles/b/geodata" ||
  fail 'cannot create executable and profile paths'

# Never run a JVM or either actual server. Capture the exact argv passed by
# the unmodified upstream launchers when they would normally start Java.
cat > "$work/stub/java" <<'EOF_JAVA'
#!/bin/sh
[ -n "${POC_RECORD-}" ] || exit 8
printf '%s\n' "$@" > "$POC_RECORD"
EOF_JAVA
chmod +x "$work/stub/java"
cp "$geoserver_source" "$work/geoserver/bin/startup.sh" ||
  fail 'cannot stage exact GeoServer script'
cp "$keycloak_source" "$work/keycloak/bin/kc.sh" ||
  fail 'cannot stage exact Keycloak script'
printf '%s\n' marker > "$work/geoserver/start.jar"

# GeoServer's catalog launcher currently fixes GEOSERVER_HOME to its
# immutable physical useful root. An explicit GEOSERVER_DATA_DIR can still
# point to a per-profile mutable directory. The unchanged upstream startup
# script is executed and its JVM argv inspected; no Java server is started.
for profile in a b
do
  (
    unset JAVA_HOME
    PATH="$work/stub:$PATH"
    export PATH
    GEOSERVER_HOME="$work/geoserver"
    GEOSERVER_DATA_DIR="$work/profiles/$profile/geodata"
    POC_RECORD="$work/geoserver-$profile-argv"
    export GEOSERVER_HOME GEOSERVER_DATA_DIR POC_RECORD
    sh "$work/geoserver/bin/startup.sh" > "$work/geoserver-$profile-stdout" 2>&1
  ) || fail "GeoServer script refused explicit $profile data dir"
  grep -F -x -- "-DGEOSERVER_DATA_DIR=$work/profiles/$profile/geodata" \
    "$work/geoserver-$profile-argv" >/dev/null ||
    fail "GeoServer launcher did not pass explicit $profile data dir"
  grep -F -x -- "-Djetty.base=$work/geoserver" \
    "$work/geoserver-$profile-argv" >/dev/null ||
    fail 'GeoServer launcher changed immutable server root'
done
printf '%s\n' 'PASS: exact GeoServer 3.0.1 startup.sh routes A/B GEOSERVER_DATA_DIR while retaining one immutable GEOSERVER_HOME'

# A simple profile-specific symlink to one Keycloak kc.sh is deliberately
# insufficient: the original script follows its own invoked symlink and
# computes kc.home.dir, jboss.server.config.dir and its classpath from the
# resulting path. This is an upstream script behavior test, not a JVM test.
for profile in a b
do
  view="$work/views/$profile/keycloak/bin"
  mkdir -p "$view"
  ln -s "$work/keycloak/bin/kc.sh" "$view/kc.sh"
  (
    JAVA="$work/stub/java"
    JAVA_OPTS='-Xmx64m'
    JAVA_ADD_OPENS='-Dprobe=true'
    JAVA_LOCALE='-Duser.language=en'
    POC_RECORD="$work/keycloak-$profile-argv"
    export JAVA JAVA_OPTS JAVA_ADD_OPENS JAVA_LOCALE POC_RECORD
    sh "$view/kc.sh" show-config > "$work/keycloak-$profile-stdout" 2>&1
  ) || fail "Keycloak upstream script failed at profile $profile"
  grep -F -x -- "-Dkc.home.dir=$work/keycloak/bin/.." \
    "$work/keycloak-$profile-argv" >/dev/null ||
    fail "Keycloak home unexpectedly selected view $profile"
  grep -F -x -- "-Djboss.server.config.dir=$work/keycloak/bin/../conf" \
    "$work/keycloak-$profile-argv" >/dev/null ||
    fail "Keycloak config unexpectedly selected view $profile"
  grep -F -x -- "$work/keycloak/bin/../lib/quarkus-run.jar" \
    "$work/keycloak-$profile-argv" >/dev/null ||
    fail "Keycloak classpath unexpectedly selected view $profile"
  if grep -F -- "$work/views/$profile/keycloak" \
    "$work/keycloak-$profile-argv" >/dev/null
  then
    fail "Keycloak args retained view path despite upstream symlink resolution"
  fi
done
printf '%s\n' 'PASS: exact Keycloak 26.7.3 kc.sh resolves A/B symlink launchers to one shared physical home, conf and classpath'
printf '%s\n' 'PASS: no JVM, upstream server, catalog install, privilege or full context behavior was invoked'
