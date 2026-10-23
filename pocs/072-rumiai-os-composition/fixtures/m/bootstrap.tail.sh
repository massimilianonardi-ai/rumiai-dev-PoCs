
PATH="$m_ROOT/bin/sys${PATH:+:$PATH}"
export PATH
if [ "$#" -eq 0 ]
then
  printf '%s\n' "$m_ROOT"
  exit 0
fi
exec "$@"
