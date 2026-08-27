#!/bin/sh

# array ARRAY_NAME size
# array ARRAY_NAME size SIZE_VAR_NAME
# array ARRAY_NAME get
# array ARRAY_NAME get INDEX
# array ARRAY_NAME get INDEX ELEM_VAR_NAME
# array ARRAY_NAME put INDEX NEW_VALUE
# array ARRAY_NAME add NEW_VALUE
# array ARRAY_NAME ins INDEX NEW_VALUE
# array ARRAY_NAME rem INDEX
# array ARRAY_NAME set NEW_VALUES...
# array ARRAY_NAME unset

#-------------------------------------------------------------------------------

. arg.lib.sh

#-------------------------------------------------------------------------------

array()
{
  eval "[ \"\$${1}_TYPE\" = \"array\" ]"
  if [ ! "$?" = "0" ]
  then
    if [ "$#" = "1" ]
    then
      eval "${1}_TYPE=\"array\""
      eval "${1}_SIZE=\"0\""
      return 0
    else
      # echo "not an array!" 1>&2
      # exit 1
      return 1
    fi
  elif [ "$#" = "1" ]
  then
    array "$1" unset
    array "$1"
    return 0
  fi

  case "$2" in
    "size")
      if [ -z "$3" ]
      then
        eval "echo \"\$${1}_SIZE\""
      else
        eval "${3}=\"\$${1}_SIZE\""
      fi
    ;;
    "get")
      if [ -z "$3" ]
      then
        while eval "[ \"\$(($# - 2))\" -lt \"\$${1}_SIZE\" ]"
        do
          set -- "$@" "$(quote "$(array "$1" get $(($# - 2)))")"
        done
        shift 2
        echo "$@"
        return 0
      fi
      eval "[ \"${3}\" -lt \"\$${1}_SIZE\" ] || exit 1"
      if [ -z "$4" ]
      then
        eval "echo \"\$${1}_${3}\""
      else
        eval "${4}=\"\$${1}_${3}\""
      fi
    ;;
    "put")
      eval "[ \"${3}\" -lt \"\$${1}_SIZE\" ] || exit 1"
      eval "${1}_${3}=\"\${4}\""
    ;;
    "add")
      eval "set -- \"\$@\" \"\$${1}_SIZE\""
      eval "${1}_${4}=\"${3}\""
      eval "${1}_SIZE=\"\$((\$${1}_SIZE + 1))\""
    ;;
    "ins")
      eval "[ \"${3}\" -lt \"\$${1}_SIZE\" ] || exit 1"
      set -- "$@" "$1" "set"
      while [ "$(($# - 6))" -lt "$3" ]
      do
        set -- "$@" "$(array "$1" get $(($# - 6)))"
      done
      set -- "$@" "$4"
      while eval "[ \"\$(($# - 7))\" -lt \"\$${1}_SIZE\" ]"
      do
        set -- "$@" "$(array "$1" get $(($# - 7)))"
      done
      shift 4
      array "$@"
    ;;
    "rem")
      eval "[ \"${3}\" -lt \"\$${1}_SIZE\" ] || exit 1"
      set -- "$@" "$1" "set"
      while [ "$(($# - 5))" -lt "$3" ]
      do
        set -- "$@" "$(array "$1" get $(($# - 5)))"
      done
      while eval "[ \"\$(($# - 4))\" -lt \"\$${1}_SIZE\" ]"
      do
        set -- "$@" "$(array "$1" get $(($# - 4)))"
      done
      shift 3
      array "$@"
    ;;
    "set")
      array "$1" unset
      array "$1"
      set -- "$@" "${1}"
      shift 2
      while [ "$#" -gt "1" ]
      do
        eval "array \"\$$#\" add \"\$1\""
        shift
      done
    ;;
    "unset")
      eval "set -- \"\$1\" \"\$${1}_SIZE\""
      while [ "$2" -gt "0" ]
      do
        eval "${1}_SIZE=\"\$((\$${1}_SIZE - 1))\""
        eval "set -- \"\$1\" \"\$${1}_SIZE\""
        eval "unset ${1}_${2}"
      done
      eval "unset ${1}_SIZE"
      eval "unset ${1}_TYPE"
    ;;
    *) exit 1;;
  esac
}
