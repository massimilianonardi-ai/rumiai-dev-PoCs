#!/bin/sh
set -eu

MICROMAMBA_URL=${MICROMAMBA_URL:-}
MICROMAMBA_SHA256=${MICROMAMBA_SHA256:-}

[ -n "$MICROMAMBA_URL" ] || { echo "ERROR MICROMAMBA_URL is required" >&2; exit 2; }
[ -n "$MICROMAMBA_SHA256" ] || { echo "ERROR MICROMAMBA_SHA256 is required" >&2; exit 2; }

need()
{
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR missing experiment tool: $1" >&2
        exit 2
    }
}

for tool in chmod curl grep mktemp rm sed; do
    need "$tool"
done

sha256_file()
{
    if command -v sha256sum >/dev/null 2>&1
    then
        sha256sum "$1" | sed 's/[[:space:]].*$//'
    elif command -v shasum >/dev/null 2>&1
    then
        shasum -a 256 "$1" | sed 's/[[:space:]].*$//'
    else
        echo "ERROR no SHA-256 command available" >&2
        return 1
    fi
}

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-python-env-poc.XXXXXX")
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

provider=$work/micromamba
curl -L --fail --silent --show-error "$MICROMAMBA_URL" -o "$provider"
chmod 700 "$provider"
actual_sha=$(sha256_file "$provider")
[ "$actual_sha" = "$MICROMAMBA_SHA256" ] || {
    echo "ERROR micromamba digest mismatch: $actual_sha" >&2
    exit 1
}
printf 'micromamba-sha256=%s\n' "$actual_sha"
"$provider" --version

export MAMBA_ROOT_PREFIX=$work/mamba-root
export PYTHON_ENV_PROVIDER=$provider

adapter=$work/python-env
cat > "$adapter" <<'EOF_ADAPTER'
#!/bin/sh
set -eu

provider=${PYTHON_ENV_PROVIDER-}
[ -n "$provider" ] && [ -x "$provider" ] || exit 1

python_env_absolute()
{
    case "$1" in
        /*) return 0 ;;
        *) return 1 ;;
    esac
}

python_env_version_valid()
{
    case "$1" in
        "" | *[!0-9.]* | .* | *. | *..*) return 1 ;;
    esac
    case "$1" in
        *.*) : ;;
        *) return 1 ;;
    esac
}

python_env_recognized()
{
    [ -d "$1" ] && [ ! -L "$1" ] &&
    [ -d "$1/conda-meta" ] && [ ! -L "$1/conda-meta" ] &&
    [ -f "$1/conda-meta/history" ] && [ ! -L "$1/conda-meta/history" ]
}

[ "$#" -ge 1 ] || exit 2
action=$1

case "$action" in
    create)
        [ "$#" -eq 3 ] || exit 2
        environment=$2
        version=$3
        python_env_absolute "$environment" || exit 2
        python_env_version_valid "$version" || exit 2
        [ ! -e "$environment" ] && [ ! -L "$environment" ] || exit 1

        "$provider" create -y -q -p "$environment" -c conda-forge "python=$version" pip || exit 1
        python_env_recognized "$environment" || exit 1
        "$provider" run -p "$environment" -- python -m pip --version >/dev/null || exit 1
        ;;

    run)
        [ "$#" -ge 4 ] || exit 2
        environment=$2
        [ "$3" = -- ] || exit 2
        shift 3
        [ "$#" -ge 1 ] || exit 2
        python_env_absolute "$environment" || exit 2
        python_env_recognized "$environment" || exit 1

        exec "$provider" run -p "$environment" -- "$@"
        ;;

    remove)
        [ "$#" -eq 2 ] || exit 2
        environment=$2
        python_env_absolute "$environment" || exit 2
        python_env_recognized "$environment" || exit 1

        "$provider" env remove -y -p "$environment" || exit 1
        if [ -d "$environment" ] && [ ! -L "$environment" ]
        then
            rmdir "$environment" 2>/dev/null || :
        fi
        [ ! -e "$environment" ] && [ ! -L "$environment" ] || exit 1
        ;;

    *)
        exit 2
        ;;
esac
EOF_ADAPTER
chmod 700 "$adapter"

env_path=$work/app-python
unrelated=$work/unrelated
mkdir "$unrelated"
printf 'keep\n' > "$unrelated/marker"

if "$adapter" create "$unrelated" 3.12 >/dev/null 2>&1
then
    echo "ERROR create overwrote an existing target" >&2
    exit 1
fi
[ "$(cat "$unrelated/marker")" = keep ] || {
    echo "ERROR create mutated an existing target" >&2
    exit 1
}
printf 'existing-target-protection=PASS\n'

if "$adapter" remove "$unrelated" >/dev/null 2>&1
then
    echo "ERROR remove accepted an unrelated directory" >&2
    exit 1
fi
[ "$(cat "$unrelated/marker")" = keep ] || {
    echo "ERROR remove mutated an unrelated directory" >&2
    exit 1
}
printf 'unrecognized-remove-protection=PASS\n'

"$adapter" create "$env_path" 3.12
version=$("$adapter" run "$env_path" -- python -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
[ "$version" = 3.12 ] || {
    echo "ERROR requested Python 3.12 but observed $version" >&2
    exit 1
}
"$adapter" run "$env_path" -- python -m pip --version >/dev/null
printf 'create-python-pip=PASS\n'

argv_probe=$work/argv-probe.py
cat > "$argv_probe" <<'EOF_ARGV'
import sys
expected = ["--help", "a b", "line1\nline2", "", "-x"]
if sys.argv[1:] != expected:
    print(f"argv mismatch: {sys.argv[1:]!r}", file=sys.stderr)
    raise SystemExit(91)
print("argv=PASS")
EOF_ARGV

newline='line1
line2'
argv_out=$("$adapter" run "$env_path" -- python "$argv_probe" --help "a b" "$newline" "" -x)
[ "$argv_out" = 'argv=PASS' ] || {
    echo "ERROR argv probe output mismatch: $argv_out" >&2
    exit 1
}
printf 'argv-preservation=PASS\n'

stream_probe=$work/stream-probe.py
cat > "$stream_probe" <<'EOF_STREAM'
import sys
payload = sys.stdin.read()
sys.stdout.write("OUT:" + payload)
sys.stderr.write("ERR:marker\n")
raise SystemExit(37)
EOF_STREAM

set +e
printf 'stdin-marker\n' | "$adapter" run "$env_path" -- python "$stream_probe" > "$work/stream.out" 2> "$work/stream.err"
stream_status=$?
set -e
[ "$stream_status" -eq 37 ] || {
    echo "ERROR child status $stream_status instead of 37" >&2
    cat "$work/stream.err" >&2 || :
    exit 1
}
grep -Fx 'OUT:stdin-marker' "$work/stream.out" >/dev/null 2>&1 || {
    echo "ERROR stdout was not preserved" >&2
    cat "$work/stream.out" >&2 || :
    exit 1
}
grep -Fx 'ERR:marker' "$work/stream.err" >/dev/null 2>&1 || {
    echo "ERROR stderr was not preserved" >&2
    cat "$work/stream.err" >&2 || :
    exit 1
}
printf 'stream-status-preservation=PASS\n'

caller_path=$PATH
PYTHON_ENV_CALLER_MARK=before
export PYTHON_ENV_CALLER_MARK
"$adapter" run "$env_path" -- python -c 'import os; assert os.environ["PYTHON_ENV_CALLER_MARK"] == "before"; os.environ["PYTHON_ENV_CALLER_MARK"] = "child"'
[ "$PYTHON_ENV_CALLER_MARK" = before ] || {
    echo "ERROR child mutated caller environment" >&2
    exit 1
}
[ "$PATH" = "$caller_path" ] || {
    echo "ERROR adapter mutated caller PATH" >&2
    exit 1
}
printf 'caller-shell-isolation=PASS\n'

"$adapter" remove "$env_path"
[ ! -e "$env_path" ] && [ ! -L "$env_path" ] || {
    echo "ERROR environment remained after remove" >&2
    exit 1
}
printf 'remove=PASS\n'

"$adapter" create "$env_path" 3.13
version=$("$adapter" run "$env_path" -- python -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
[ "$version" = 3.13 ] || {
    echo "ERROR requested Python 3.13 but observed $version" >&2
    exit 1
}
printf 'python-version-rebuild=PASS\n'

"$adapter" remove "$env_path"
printf 'PASS python-env micromamba adapter experiment\n'
