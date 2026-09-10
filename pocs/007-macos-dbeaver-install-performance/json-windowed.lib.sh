_json_fields_join()
(
  [ "$#" -ge 1 ] || return 2

  json_fields_join_value=
  for json_fields_join_field in "$@"
  do
    case "$json_fields_join_field" in
      ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) return 2;;
    esac
    case ",$json_fields_join_value," in
      *,"$json_fields_join_field",*) return 2;;
    esac
    if [ -n "$json_fields_join_value" ]
    then
      json_fields_join_value="$json_fields_join_value,$json_fields_join_field"
    else
      json_fields_join_value=$json_fields_join_field
    fi
  done

  printf -- '%s\n' "$json_fields_join_value"
)

_json_extract()
(
  [ "$#" -eq 3 ] || return 2

  json_extract_mode=$1
  json_extract_array_field=$2
  json_extract_fields=$3

  LC_ALL=C command -p -- awk \
    -v mode="$json_extract_mode" \
    -v array_field="$json_extract_array_field" \
    -v fields="$json_extract_fields" '
function fail() { failed=1; exit 1 }
function load_window() {
  if (pos < window_start || pos > window_end) {
    window_start=pos
    window=substr(src, window_start, 4096)
    window_end=window_start+length(window)-1
  }
}
function peek(    offset) {
  if (pos > src_len) return ""
  load_window()
  offset=pos-window_start+1
  return substr(window, offset, 1)
}
function peek_n(n,    offset,available) {
  if (n <= 0 || pos > src_len) return ""
  load_window()
  offset=pos-window_start+1
  available=window_end-pos+1
  if (n <= available) return substr(window, offset, n)
  return substr(src, pos, n)
}
function skip_ws(    c) {
  while (pos <= src_len) {
    c=peek()
    if (c==" " || c=="\t" || c=="\r" || c=="\n") pos++
    else break
  }
}
function expect(ch) {
  skip_ws()
  if (peek_n(length(ch)) != ch) fail()
  pos += length(ch)
}
function parse_string(capture,    c,e,h,i,out) {
  skip_ws()
  parsed_string_unicode=0
  if (peek() != "\"") fail()
  pos++
  out=""
  while (pos <= src_len) {
    c=peek()
    pos++
    if (c == "\"") return out
    if (c == "\\") {
      if (pos > src_len) fail()
      e=peek()
      pos++
      if (e == "\"" || e == "\\" || e == "/") {
        if (capture) out=out e
      }
      else if (e == "b") {
        if (capture) out=out sprintf("%c", 8)
      }
      else if (e == "f") {
        if (capture) out=out sprintf("%c", 12)
      }
      else if (e == "n") {
        if (capture) out=out "\n"
      }
      else if (e == "r") {
        if (capture) out=out "\r"
      }
      else if (e == "t") {
        if (capture) out=out "\t"
      }
      else if (e == "u") {
        if (pos + 3 > src_len) fail()
        h=peek_n(4)
        if (h !~ /^[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]$/) fail()
        pos += 4
        parsed_string_unicode=1
        if (capture) out=out "\\u" h
      }
      else fail()
    }
    else {
      if (c ~ /[[:cntrl:]]/) fail()
      if (capture) out=out c
    }
  }
  fail()
}
function parse_number(    start,c,value) {
  skip_ws()
  start=pos
  while (pos <= src_len) {
    c=peek()
    if (c ~ /[0-9eE+.-]/) pos++
    else break
  }
  value=substr(src, start, pos-start)
  if (value !~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/) fail()
  return value
}
function skip_value(    c,key) {
  skip_ws()
  c=peek()
  if (c == "\"") { parse_string(0); return }
  if (c == "{") {
    pos++
    skip_ws()
    if (peek() == "}") { pos++; return }
    while (1) {
      parse_string(0)
      expect(":")
      skip_value()
      skip_ws()
      c=peek()
      if (c == ",") { pos++; continue }
      if (c == "}") { pos++; return }
      fail()
    }
  }
  if (c == "[") {
    pos++
    skip_ws()
    if (peek() == "]") { pos++; return }
    while (1) {
      skip_value()
      skip_ws()
      c=peek()
      if (c == ",") { pos++; continue }
      if (c == "]") { pos++; return }
      fail()
    }
  }
  if (peek_n(4) == "true") { pos+=4; return }
  if (peek_n(5) == "false") { pos+=5; return }
  if (peek_n(4) == "null") { pos+=4; return }
  parse_number()
}
function parse_typed_scalar(    c,value) {
  skip_ws()
  c=peek()
  if (c == "\"") {
    value=parse_string(1)
    if (parsed_string_unicode) fail()
    if (index(value, "\t") || index(value, "\r") || index(value, "\n")) fail()
    return "s:" value
  }
  if (peek_n(4) == "true") { pos+=4; return "b:true" }
  if (peek_n(5) == "false") { pos+=5; return "b:false" }
  if (peek_n(4) == "null") { pos+=4; return "z:" }
  if (c == "{" || c == "[") fail()
  value=parse_number()
  return "n:" value
}
function reset_record(    i,k) {
  for (k in record) delete record[k]
  for (k in seen) delete seen[k]
  for (i=1; i<=field_count; i++) record[i]="m:"
}
function emit_record(    i,line) {
  line=""
  for (i=1; i<=field_count; i++) {
    if (i > 1) line=line "\t"
    line=line record[i]
  }
  print line
}
function parse_object_record(emit,    c,key,idx) {
  skip_ws()
  if (peek() != "{") fail()
  pos++
  reset_record()
  skip_ws()
  if (peek() == "}") {
    pos++
    if (emit) emit_record()
    return
  }
  while (1) {
    key=parse_string(1)
    expect(":")
    idx=wanted[key]
    if (idx) {
      if (seen[idx]) fail()
      seen[idx]=1
      record[idx]=parse_typed_scalar()
    }
    else skip_value()
    skip_ws()
    c=peek()
    if (c == ",") { pos++; continue }
    if (c == "}") {
      pos++
      if (emit) emit_record()
      return
    }
    fail()
  }
}
function parse_root_array(    c) {
  skip_ws()
  if (peek() != "[") fail()
  pos++
  skip_ws()
  if (peek() == "]") { pos++; return }
  while (1) {
    parse_object_record(1)
    skip_ws()
    c=peek()
    if (c == ",") { pos++; continue }
    if (c == "]") { pos++; return }
    fail()
  }
}
function parse_named_array(    c) {
  skip_ws()
  if (peek() != "[") fail()
  pos++
  skip_ws()
  if (peek() == "]") { pos++; return }
  while (1) {
    parse_object_record(1)
    skip_ws()
    c=peek()
    if (c == ",") { pos++; continue }
    if (c == "]") { pos++; return }
    fail()
  }
}
function parse_root_object_for_array(    c,key) {
  skip_ws()
  if (peek() != "{") fail()
  pos++
  skip_ws()
  if (peek() == "}") fail()
  while (1) {
    key=parse_string(1)
    expect(":")
    if (key == array_field) {
      if (array_seen) fail()
      array_seen=1
      parse_named_array()
    }
    else skip_value()
    skip_ws()
    c=peek()
    if (c == ",") { pos++; continue }
    if (c == "}") {
      pos++
      if (!array_seen) fail()
      return
    }
    fail()
  }
}
{
  src=src $0 "\n"
}
END {
  if (failed) exit 1
  src_len=length(src)
  pos=1
  window_start=0
  window_end=0
  window=""
  field_count=split(fields, field_name, ",")
  if (field_count < 1) fail()
  for (i=1; i<=field_count; i++) {
    if (field_name[i] == "" || wanted[field_name[i]]) fail()
    wanted[field_name[i]]=i
  }
  if (mode == "object") parse_object_record(1)
  else if (mode == "array") parse_root_array()
  else if (mode == "object-array") parse_root_object_for_array()
  else fail()
  skip_ws()
  if (pos <= src_len) fail()
}
' || return 1
)

json_object_fields()
(
  [ "$#" -ge 1 ] || return 2
  json_object_fields_names="$(_json_fields_join "$@")" || return "$?"
  _json_extract object '' "$json_object_fields_names"
)

json_array_object_fields()
(
  [ "$#" -ge 1 ] || return 2
  json_array_object_fields_names="$(_json_fields_join "$@")" || return "$?"
  _json_extract array '' "$json_array_object_fields_names"
)

json_object_array_object_fields()
(
  [ "$#" -ge 2 ] || return 2
  json_object_array_object_fields_array=$1
  shift
  case "$json_object_array_object_fields_array" in
    ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) return 2;;
  esac
  json_object_array_object_fields_names="$(_json_fields_join "$@")" || return "$?"
  _json_extract object-array "$json_object_array_object_fields_array" "$json_object_array_object_fields_names"
)

_json_assign()
{
  [ "$#" -eq 2 ] || return 2
  case "$1" in
    ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) return 2;;
  esac
  IFS= read -r "$1" <<EOF_JSON_ASSIGN
$2
EOF_JSON_ASSIGN
}

json_object_read()
{
  [ "$#" -ge 2 ] && [ $(( $# % 2 )) -eq 0 ] || return 2

  json_object_read_fields=
  json_object_read_variables=
  while [ "$#" -gt 0 ]
  do
    case "$1" in
      ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) return 2;;
    esac
    case "$2" in
      ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) return 2;;
    esac
    if [ -n "$json_object_read_fields" ]
    then
      json_object_read_fields="$json_object_read_fields,$1"
      json_object_read_variables="$json_object_read_variables,$2"
    else
      json_object_read_fields=$1
      json_object_read_variables=$2
    fi
    shift 2
  done

  json_object_read_record="$(_json_extract object '' "$json_object_read_fields")" || return "$?"
  json_object_read_tab="$(printf '\t')"

  json_object_read_old_ifs=$IFS
  IFS=,
  set -- $json_object_read_variables
  IFS=$json_object_read_old_ifs

  json_object_read_record_rest=$json_object_read_record
  json_object_read_index=1
  for json_object_read_variable in "$@"
  do
    if [ "$json_object_read_index" -lt "$#" ]
    then
      case "$json_object_read_record_rest" in
        *"$json_object_read_tab"*)
          json_object_read_value=${json_object_read_record_rest%%"$json_object_read_tab"*}
          json_object_read_record_rest=${json_object_read_record_rest#*"$json_object_read_tab"}
          ;;
        *) return 1;;
      esac
    else
      case "$json_object_read_record_rest" in
        *"$json_object_read_tab"*) return 1;;
        *) json_object_read_value=$json_object_read_record_rest;;
      esac
      json_object_read_record_rest=
    fi
    _json_assign "$json_object_read_variable" "$json_object_read_value" || return "$?"
    json_object_read_index=$((json_object_read_index + 1))
  done

  [ -z "$json_object_read_record_rest" ] || return 1
}
