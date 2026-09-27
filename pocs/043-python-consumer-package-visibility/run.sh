#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { echo "usage: $0 /path/to/rumiai-os" >&2; exit 2; }
source_root=$1
PYTHON=${PYTHON:-python3}

[ -x "$source_root/m" ] || { echo "ERROR rumiai-os checkout missing m" >&2; exit 2; }
command -v "$PYTHON" >/dev/null 2>&1 || { echo "ERROR Python unavailable: $PYTHON" >&2; exit 2; }

physical_dir()
{
    (
        CDPATH= cd "$1" 2>/dev/null
        pwd -P
    )
}

tmp_base=/tmp
[ -z "${TMPDIR-}" ] || tmp_base=$TMPDIR
work=$(mktemp -d "$tmp_base/rumiai-python-visibility-poc.XXXXXX")
work=$(physical_dir "$work")

cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

root=$work/target-a
cp -R "$source_root" "$root"
[ -d "$root/pkg" ] || mkdir "$root/pkg"

run_pkg()
{
    "$root/m" "$root/bin/sys/pkg" "$@"
}

facility=poc43python
provider=poc43provider
consumer_path=poc43path$$
consumer_site=poc43site$$
consumer_user=poc43user$$

integration_driver=$work/integration-driver
cat > "$integration_driver" <<'EOF_DRIVER'
#!/usr/bin/env m
. "$m_LIB_DIR/sys/sh/pkg/pkg-integration.lib.sh" || exit 3
[ "$1" = integrate ] || exit 2
shift
[ -f "$3/format" ] || printf '%s\n' tar.gz > "$3/format" || exit 3
pkg_integrate "$@"
EOF_DRIVER
chmod 700 "$integration_driver"

export POC43_PYTHON
POC43_PYTHON=$(command -v "$PYTHON")

provider_range=$work/provider-range
provider_payload=$work/provider-payload
mkdir -p "$provider_range/facility-cmd/$facility" "$provider_payload/bin"
printf '%s %s\n' "$facility" 1 > "$provider_range/facility"
printf '%s\n' bin/python > "$provider_range/facility-cmd/$facility/python"
cat > "$provider_payload/bin/python" <<'EOF_PROVIDER'
#!/bin/sh
exec "$POC43_PYTHON" "$@"
EOF_PROVIDER
chmod 700 "$provider_payload/bin/python"

"$root/m" "$integration_driver" integrate "$provider" 1 "$provider_range" "$provider_payload"
run_pkg default "$provider@1" >/dev/null
run_pkg provider default "$facility" "$provider" >/dev/null

userbase_probe=$work/userbase-probe
mkdir "$userbase_probe"
userbase_probe=$(physical_dir "$userbase_probe")
user_site_abs=$(PYTHONUSERBASE="$userbase_probe" "$PYTHON" -c 'import site; print(site.getusersitepackages())')
case "$user_site_abs" in
    "$userbase_probe"/*) user_site_rel=${user_site_abs#"$userbase_probe"/} ;;
    *)
        echo "ERROR Python user site is outside PYTHONUSERBASE: $user_site_abs" >&2
        exit 1
        ;;
esac
python_minor=$("$PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
printf 'python-minor=%s\n' "$python_minor"
printf 'user-site-relative-layout=%s\n' "$user_site_rel"
case "$user_site_rel" in
    *"$python_minor"*) printf 'user-site-layout-version-coupled=yes\n' ;;
    *) printf 'user-site-layout-version-coupled=no\n' ;;
esac

populate_site()
{
    site_dir=$1
    mkdir -p "$site_dir/visprobe" "$site_dir/extra_path"

    cat > "$site_dir/visprobe/__init__.py" <<'EOF_VISPROBE'
import os
import site
import sys

def main():
    try:
        import extra_probe
        extra = extra_probe.VALUE
    except ModuleNotFoundError:
        extra = "missing"

    user_site = site.getusersitepackages()
    print("fixture=visibility")
    print("pth=" + os.environ.get("RUMIAI_PTH_EXECUTED", "no"))
    print("extra=" + extra)
    print("version=" + str(sys.version_info.major) + "." + str(sys.version_info.minor))
    print("module=" + __file__)
    print("user-site=" + user_site)
    print("user-site-present=" + ("yes" if user_site in sys.path else "no"))
    return 0
EOF_VISPROBE

    cat > "$site_dir/extra_path/extra_probe.py" <<'EOF_EXTRA'
VALUE = "extra-ok"
EOF_EXTRA

    cat > "$site_dir/rumiai_probe.pth" <<'EOF_PTH'
extra_path
import os; os.environ["RUMIAI_PTH_EXECUTED"] = "yes"
EOF_PTH
}

make_payload()
{
    mode=$1
    payload=$2
    mkdir -p "$payload/bin"

    cat > "$payload/bin/probe" <<'EOF_PROBE'
#!/usr/bin/env python
from visprobe import main
raise SystemExit(main())
EOF_PROBE
    chmod 700 "$payload/bin/probe"

    case "$mode" in
        path)
            populate_site "$payload/python/site-packages"
            ;;
        site)
            populate_site "$payload/python/site-packages"
            mkdir -p "$payload/python/bootstrap"
            cat > "$payload/python/bootstrap/sitecustomize.py" <<'EOF_SITECUSTOMIZE'
import os
import site

site.addsitedir(os.environ["RUMIAI_PYTHON_SITE"])
EOF_SITECUSTOMIZE
            ;;
        user)
            populate_site "$payload/python/userbase/$user_site_rel"
            ;;
        *)
            return 2
            ;;
    esac
}

make_consumer()
{
    package=$1
    command_name=$2
    mode=$3
    payload=$4

    range=$work/range-$package
    mkdir -p "$range/cmd" "$range/link"
    printf '%s\n' "$facility =1" > "$range/dependency"
    printf '%s\n' bin/probe > "$range/link/$command_name"

    cat > "$range/cmd/$command_name" <<EOF_COMMAND
#!/usr/bin/env m
. "\$m_LIB_DIR/sys/sh/pkg/pkg-launch.lib.sh"
launcher "$package" "\$@"
EOF_COMMAND
    chmod 600 "$range/cmd/$command_name"

    case "$mode" in
        path)
            cat > "$range/env" <<'EOF_PATH_ENV'
PYTHONPATH="$pkg_launch_root/python/site-packages"
PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH PYTHONDONTWRITEBYTECODE
EOF_PATH_ENV
            ;;
        site)
            cat > "$range/env" <<'EOF_SITE_ENV'
RUMIAI_PYTHON_SITE="$pkg_launch_root/python/site-packages"
PYTHONPATH="$pkg_launch_root/python/bootstrap"
PYTHONDONTWRITEBYTECODE=1
export RUMIAI_PYTHON_SITE PYTHONPATH PYTHONDONTWRITEBYTECODE
EOF_SITE_ENV
            ;;
        user)
            cat > "$range/env" <<'EOF_USER_ENV'
PYTHONUSERBASE="$pkg_launch_root/python/userbase"
PYTHONDONTWRITEBYTECODE=1
unset PYTHONNOUSERSITE
export PYTHONUSERBASE PYTHONDONTWRITEBYTECODE
EOF_USER_ENV
            ;;
        *)
            return 2
            ;;
    esac
    chmod 600 "$range/env"

    "$root/m" "$integration_driver" integrate "$package" 1 "$range" "$payload"
    run_pkg default "$package@1" >/dev/null
}

payload_path=$work/payload-path
payload_site=$work/payload-site
payload_user=$work/payload-user
make_payload path "$payload_path"
make_payload site "$payload_site"
make_payload user "$payload_user"

make_consumer "$consumer_path" poc43path path "$payload_path"
make_consumer "$consumer_site" poc43site site "$payload_site"
make_consumer "$consumer_user" poc43user user "$payload_user"

host_path=$PATH

run_managed()
{
    command_name=$1
    output=$2
    (
        unset PYTHONPATH PYTHONHOME PYTHONUSERBASE PYTHONNOUSERSITE
        unset RUMIAI_PYTHON_SITE RUMIAI_PTH_EXECUTED
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

assert_mode()
{
    stage=$1
    command_name=$2
    expected_pth=$3
    expected_extra=$4
    output=$work/$stage-$command_name.out

    run_managed "$command_name" "$output"
    assert_line "$output" 'fixture=visibility'
    assert_line "$output" "pth=$expected_pth"
    assert_line "$output" "extra=$expected_extra"
}

assert_mode before poc43path no missing
assert_mode before poc43site yes extra-ok
assert_mode before poc43user yes extra-ok
assert_line "$work/before-poc43user.out" 'user-site-present=yes'
printf 'direct-pythonpath-pth-processing=PASS_IGNORED\n'
printf 'sitecustomize-addsitedir-pth-processing=PASS\n'
printf 'pythonuserbase-pth-processing=PASS\n'

old_root=$root
old_root_physical=$(physical_dir "$old_root")
root=$work/target-b
mv "$old_root" "$root"
root=$(physical_dir "$root")

assert_mode after poc43path no missing
assert_mode after poc43site yes extra-ok
assert_mode after poc43user yes extra-ok
assert_line "$work/after-poc43user.out" 'user-site-present=yes'
printf 'all-visibility-modes-after-root-move=PASS\n'

"$PYTHON" - "$old_root_physical"     "$root/pkg/$consumer_path@1"     "$root/pkg/$consumer_site@1"     "$root/pkg/$consumer_user@1" <<'PY_SCAN'
import pathlib
import sys

needle = sys.argv[1].encode()
hits = []
for root_text in sys.argv[2:]:
    for path in pathlib.Path(root_text).rglob("*"):
        if path.is_file() and not path.is_symlink():
            try:
                data = path.read_bytes()
            except OSError:
                continue
            if needle in data:
                hits.append(str(path))
if hits:
    print("old-root-hits:")
    print("\n".join(hits))
    raise SystemExit(1)
PY_SCAN
printf 'consumer-old-root-scan=PASS\n'
printf 'PASS Python consumer package visibility experiment\n'
