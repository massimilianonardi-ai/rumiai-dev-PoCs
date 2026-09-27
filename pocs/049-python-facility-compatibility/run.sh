#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { echo "usage: $0 /path/to/rumiai-os" >&2; exit 2; }
source_root=$1
PYTHON=${PYTHON:-python3}

[ -x "$source_root/m" ] || { echo "ERROR rumiai-os checkout missing m" >&2; exit 2; }
command -v "$PYTHON" >/dev/null 2>&1 || { echo "ERROR Python unavailable: $PYTHON" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-python-facility-poc.XXXXXX")
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

root=$work/root
cp -R "$source_root" "$root"
[ -d "$root/pkg" ] || mkdir "$root/pkg"

run_pkg()
{
    "$root/m" "$root/bin/sys/pkg" "$@"
}

generic_facility=poc49python
cpython_facility=poc49cpython
provider312=poc49cp312
provider313=poc49cp313
alternate313=poc49alt313
pure_consumer=poc49pure
abi3_consumer=poc49abi3
cp312_consumer=poc49minor312
command_pure=poc49pure
command_abi3=poc49abi3
command_cp312=poc49minor312

integration_driver=$work/integration-driver
cat > "$integration_driver" <<'EOF_DRIVER'
#!/usr/bin/env m
loadsyslib "pkg/pkg-integration" || exit 3
[ "$1" = integrate ] || exit 2
shift
[ -f "$3/format" ] || printf '%s\n' tar.gz > "$3/format" || exit 3
pkg_integrate "$@"
EOF_DRIVER
chmod 700 "$integration_driver"

export POC49_HOST_PYTHON
POC49_HOST_PYTHON=$(command -v "$PYTHON")

make_provider()
{
    package=$1
    marker=$2
    generic_level=$3
    cpython_level=$4

    range=$work/range-$package
    payload=$work/payload-$package
    mkdir -p "$range/facility-cmd/$generic_facility" "$payload/bin"

    if [ -n "$cpython_level" ]
    then
        mkdir -p "$range/facility-cmd/$cpython_facility"
        {
            printf '%s %s\n' "$cpython_facility" "$cpython_level"
            printf '%s %s\n' "$generic_facility" "$generic_level"
        } > "$range/facility"
    else
        printf '%s %s\n' "$generic_facility" "$generic_level" > "$range/facility"
    fi

    printf '%s\n' bin/python-generic > "$range/facility-cmd/$generic_facility/python"
    cat > "$payload/bin/python-generic" <<EOF_PY_GENERIC
#!/bin/sh
printf '%s\n' 'provider=$marker'
exec "\$POC49_HOST_PYTHON" "\$@"
EOF_PY_GENERIC
    chmod 700 "$payload/bin/python-generic"

    if [ -n "$cpython_level" ]
    then
        printf '%s\n' bin/python-cpython > "$range/facility-cmd/$cpython_facility/python"
        cat > "$payload/bin/python-cpython" <<EOF_PY_CPYTHON
#!/bin/sh
printf '%s\n' 'provider=$marker'
exec "\$POC49_HOST_PYTHON" "\$@"
EOF_PY_CPYTHON
        chmod 700 "$payload/bin/python-cpython"
    fi

    "$root/m" "$integration_driver" integrate "$package" 1 "$range" "$payload"
    run_pkg default "$package@1" >/dev/null
}

make_provider "$provider312" cp312 3.12 3.12
make_provider "$provider313" cp313 3.13 3.13
make_provider "$alternate313" alt313 3.13 ""

run_pkg provider default "$generic_facility" "$provider312" >/dev/null
run_pkg provider default "$cpython_facility" "$provider312" >/dev/null

make_consumer()
{
    package=$1
    command_name=$2
    dependency_line=$3

    range=$work/range-$package
    payload=$work/payload-$package
    mkdir -p "$range/cmd" "$range/link" "$payload/bin"

    printf '%s\n' "$dependency_line" > "$range/dependency"
    printf '%s\n' bin/probe > "$range/link/$command_name"

    cat > "$range/cmd/$command_name" <<EOF_COMMAND
#!/usr/bin/env m
loadsyslib "pkg/pkg-launch"
launcher "$package" "\$@"
EOF_COMMAND
    chmod 600 "$range/cmd/$command_name"

    cat > "$payload/bin/probe" <<EOF_PROBE
#!/usr/bin/env python
print("consumer=$package")
EOF_PROBE
    chmod 700 "$payload/bin/probe"

    "$root/m" "$integration_driver" integrate "$package" 1 "$range" "$payload"
    run_pkg default "$package@1" >/dev/null
}

make_consumer "$pure_consumer" "$command_pure" "$generic_facility >=3.12 <3.14"
make_consumer "$abi3_consumer" "$command_abi3" "$cpython_facility >=3.8 <3.14"
make_consumer "$cp312_consumer" "$command_cp312" "$cpython_facility =3.12"

host_path=$PATH

run_managed()
{
    command_name=$1
    output=$2
    (
        PATH="$root/bin/ext:$root/bin/sys:$host_path"
        export PATH
        "$command_name" > "$output"
    )
}

assert_line()
{
    file=$1
    line=$2
    grep -Fx "$line" "$file" >/dev/null 2>&1 || {
        echo "ERROR missing '$line' in $file" >&2
        cat "$file" >&2
        exit 1
    }
}

assert_run()
{
    label=$1
    command_name=$2
    provider_marker=$3
    consumer_name=$4
    output=$work/$label.out
    run_managed "$command_name" "$output"
    assert_line "$output" "provider=$provider_marker"
    assert_line "$output" "consumer=$consumer_name"
}

assert_incompatible_never_executes()
{
    label=$1
    consumer=$2
    facility=$3
    selector=$4
    command_name=$5

    bind_err=$work/$label-bind.err
    if run_pkg provider bind "$consumer" "$facility" "$selector" > /dev/null 2> "$bind_err"
    then
        output=$work/$label.out
        err=$work/$label.err
        if run_managed "$command_name" "$output" 2> "$err"
        then
            echo "ERROR incompatible provider executed consumer: $label" >&2
            cat "$output" >&2
            exit 1
        fi
        if [ -s "$output" ] && grep -F 'consumer=' "$output" >/dev/null 2>&1
        then
            echo "ERROR incompatible selection reached consumer target: $label" >&2
            cat "$output" >&2
            exit 1
        fi
        printf '%s=PASS_RUNTIME_REJECT\n' "$label"
        run_pkg provider bind -u -- "$consumer" "$facility" >/dev/null
    else
        printf '%s=PASS_BIND_REJECT\n' "$label"
    fi
}

# Pure Python uses the generic runtime facility and may switch implementation.
assert_run pure-inherited "$command_pure" cp312 "$pure_consumer"
run_pkg provider bind "$pure_consumer" "$generic_facility" "$alternate313" >/dev/null
assert_run pure-alt-bound "$command_pure" alt313 "$pure_consumer"
run_pkg provider bind -u -- "$pure_consumer" "$generic_facility" >/dev/null
assert_run pure-restored "$command_pure" cp312 "$pure_consumer"
printf 'pure-generic-runtime-rebinding=PASS\n'

# An abi3-like CPython consumer may move across compatible CPython levels.
assert_run abi3-inherited "$command_abi3" cp312 "$abi3_consumer"
run_pkg provider bind "$abi3_consumer" "$cpython_facility" "$provider313" >/dev/null
assert_run abi3-bound-313 "$command_abi3" cp313 "$abi3_consumer"
run_pkg provider bind -u -- "$abi3_consumer" "$cpython_facility" >/dev/null
printf 'abi3-cpython-range-rebinding=PASS\n'

# A minor-specific consumer must not execute with a different CPython level.
assert_run cp312-inherited "$command_cp312" cp312 "$cp312_consumer"
assert_incompatible_never_executes cp312-with-cp313 "$cp312_consumer" "$cpython_facility" "$provider313" "$command_cp312"
printf 'cp312-exact-level-protection=PASS\n'

# A CPython-specific consumer cannot use a provider exposing generic Python only.
assert_incompatible_never_executes cpython-with-generic-only "$abi3_consumer" "$cpython_facility" "$alternate313" "$command_abi3"
printf 'cpython-provider-class-protection=PASS\n'

# Facility default changes are observed by an unbound pure consumer.
run_pkg provider default "$generic_facility" "$alternate313" >/dev/null
assert_run pure-default-alt "$command_pure" alt313 "$pure_consumer"
printf 'generic-facility-default-late-binding=PASS\n'

printf 'PASS Python facility compatibility mapping experiment\n'
