#!/bin/sh

check_file()
{
  report=$1
  file=$2
  first=$(sed -n '1p' "$file") || return 1

  case $first in
    '#!'*)
      if [ "$first" != '#!/bin/sh' ]
      then
        printf '%s: invalid shebang: %s\n' "$file" "$first" >> "$report"
      fi
      ;;
    *) return 0 ;;
  esac

  check_fixed "$report" "$file" 'BASH_SOURCE'
  check_fixed "$report" "$file" '$RANDOM'
  check_fixed "$report" "$file" 'readlink -f'
  check_fixed "$report" "$file" '[['
  check_fixed "$report" "$file" '/Users/'
  check_fixed "$report" "$file" '/Volumes/'
  check_fixed "$report" "$file" '/opt/homebrew/'
  check_fixed "$report" "$file" '/usr/local/'

  if grep -n 'printf[[:space:]][[:space:]]*"\$' "$file" >/dev/null 2>&1
  then
    printf '%s: variable printf format operand requires review\n' "$file" >> "$report"
  fi
}

check_fixed()
{
  report=$1
  file=$2
  pattern=$3
  if grep -nF "$pattern" "$file" >/dev/null 2>&1
  then
    printf '%s: forbidden/review pattern: %s\n' "$file" "$pattern" >> "$report"
  fi
}

if [ "$1" = '--file' ] 2>/dev/null
then
  check_file "$2" "$3"
  exit 0
fi

[ "$#" -eq 1 ] || { printf 'usage: %s DIRECTORY\n' "$0" >&2; exit 2; }
root=$1
[ -d "$root" ] || { printf 'not a directory: %s\n' "$root" >&2; exit 2; }

script_dir=$(CDPATH= cd -P "${0%/*}" && pwd -P) || exit 1
work_dir="$script_dir/../.work/lint-$$"
report="$work_dir/report"
mkdir -p "$work_dir" || exit 1
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
: > "$report"

find "$root" -type f -exec "$0" --file "$report" '{}' ';'

if [ -s "$report" ]
then
  cat "$report" >&2
  exit 1
fi

printf 'PASS: portable-shell static checks\n'
