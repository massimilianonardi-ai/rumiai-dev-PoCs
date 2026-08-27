#!/bin/sh

rumiai_print()
{
  [ "$#" -eq 1 ] || return 2
  printf '%s' "$1"
}

rumiai_println()
{
  [ "$#" -eq 1 ] || return 2
  printf '%s\n' "$1"
}
