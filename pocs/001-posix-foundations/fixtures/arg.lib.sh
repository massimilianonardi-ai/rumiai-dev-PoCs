#!/bin/sh

#------------------------------------------------------------------------------

quote()
{
  if [ -z "$1" ]
  then
    printf "''"
  fi

  # printf %s\\n "$1" | sed "s/'/'\\\\''/g;1s/^/'/;\$s/\$/'/"
  printf "%s" "$1" | sed "s/'/'\\\\''/g;1s/^/'/;\$s/\$/'/"
}

# current_args="$(saveargs "$@")"
# set -- foo bar baz boo
# eval "set -- $current_args"
___saveargs()
{
  for i
  do
    printf %s\\n "$i" | sed "s/'/'\\\\''/g;1s/^/'/;\$s/\$/' \\\\/"
  done
  echo " "
}

___saveargs()
{
  for i
  do
    quote "$i"
    printf " "
  done
}

___saveargs()
{
  while [ "$#" -gt "0" ]
  do
    quote "$1"
    shift
    if [ "$#" -gt "0" ]
    then
      printf " "
    fi
  done
}

saveargs()
{
  while [ "$#" -gt "1" ]
  do
    quote "$1"
    shift
    printf " "
  done

  if [ "$#" -gt "0" ]
  then
    quote "$1"
  fi
}

#-------------------------------------------------------------------------------
