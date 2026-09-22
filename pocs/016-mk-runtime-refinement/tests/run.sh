#!/bin/sh
set -eu

fail()
{
  printf -- '%s\n' "poc-016: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: $0 <candidate-mk-lib-js>"
engine=$1
[ -f "$engine" ] || fail "candidate engine not found: $engine"
command -v node >/dev/null 2>&1 || fail "node is unavailable"

tmp=${TMPDIR:-/tmp}/rumiai-poc-016-$$
trap 'rm -rf "$tmp"' 0 HUP INT TERM
mkdir -p "$tmp/project/src" "$tmp/v1" || fail "cannot create fixture"
printf 'alpha\n' > "$tmp/project/src/a.txt"
printf 'extra\n' > "$tmp/project/src/extra.txt"

run_mk()
{
  node -e 'const mk=require(process.argv[1]); process.exit(mk.mkMain(process.argv.slice(2)));' -- "$engine" "$@"
}

cat > "$tmp/v1/mk.json" <<'JSON'
{"version":1,"goals":{"build":["b"]},"operations":{"a":{},"b":{"prerequisites":["a"]}}}
JSON
[ "$(run_mk --project "$tmp/v1" --plan build)" = "a
b" ] || fail "version 1 plan compatibility changed"

cat > "$tmp/project/mk.json" <<'JSON'
{
  "version": 2,
  "goals": {
    "generated": ["bundle"],
    "branch": ["small", "large"],
    "fallback": ["preferred-ok", "fallback-op"],
    "state": ["state-present", "state-absent"]
  },
  "collections": {
    "initial": {"type":"files","root":"src","suffixes":[".txt"]},
    "generated": {"type":"files","root":"generated","suffixes":[".txt"],"after":["generate"]}
  },
  "providers": {
    "copy-initial": {"type":"map-process","collection":"initial","action":{"type":"process","command":"sh","args":["-c","mkdir -p out; cp \"$1\" \"out/${1##*/}\"","sh","${item}"]}},
    "copy-generated": {"type":"map-process","collection":"generated","action":{"type":"process","command":"sh","args":["-c","mkdir -p out; cp \"$1\" \"out/g-${1##*/}\"","sh","${item}"]}}
  },
  "operations": {
    "generate": {"action":{"type":"process","command":"sh","args":["-c","mkdir -p generated; printf 'beta\\n' > generated/b.txt; printf 'gamma\\n' > generated/c.txt"]}},
    "bundle": {"prerequisites":["copy-initial","copy-generated"],"action":{"type":"process","command":"sh","args":["-c","printf 'artifact\\n' > bundle.txt"]},"outputs":{"artifact":{"path":"bundle.txt"}}},
    "small": {"when":{"op":"lt","left":{"output":{"operation":"bundle","name":"artifact","property":"size"}},"right":100},"action":{"type":"process","command":"sh","args":["-c","printf small > small.txt"]}},
    "large": {"when":{"op":"gte","left":{"output":{"operation":"bundle","name":"artifact","property":"size"}},"right":100},"action":{"type":"process","command":"sh","args":["-c","printf large > large.txt"]}},
    "attempt": {"failure":"continue","action":{"type":"process","command":"sh","args":["-c","exit 7"]}},
    "preferred-ok": {"when":{"op":"eq","left":{"result":{"operation":"attempt","field":"status"}},"right":0}},
    "fallback-op": {"when":{"op":"ne","left":{"result":{"operation":"attempt","field":"status"}},"right":0},"action":{"type":"process","command":"sh","args":["-c","printf fallback > fallback.txt"]}},
    "state-present": {"when":{"op":"truthy","value":{"state":{"path":"marker","property":"exists"}}},"action":{"type":"process","command":"sh","args":["-c","printf yes > state-present.txt"]}},
    "state-absent": {"when":{"op":"not","condition":{"op":"truthy","value":{"state":{"path":"marker","property":"exists"}}}},"action":{"type":"process","command":"sh","args":["-c","printf yes > state-absent.txt"]}}
  },
  "profiles": {"release":{"collections":{"initial":{"type":"files","root":"src","include":["a.txt"]}}}}
}
JSON

plan="$tmp/plan.json"
run_mk --project "$tmp/project" --plan generated > "$plan" || fail "initial generated-source plan failed"
[ ! -e "$tmp/project/generated" ] || fail "plan execution created generated files"
node - "$plan" <<'NODE' || fail "initial plan did not preserve known/pending resolution"
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const c=Object.fromEntries(p.collections.map(x=>[x.name,x]));
const r=Object.fromEntries(p.providers.map(x=>[x.name,x]));
if (JSON.stringify(c.initial.items)!==JSON.stringify(['src/a.txt','src/extra.txt'])) process.exit(1);
if (c.generated.state!=='pending'||JSON.stringify(c.generated.waitingFor)!==JSON.stringify(['generate'])) process.exit(2);
if (r['copy-generated'].state!=='pending') process.exit(3);
if (!p.operations.some(x=>x.name==='generate'&&x.state==='ready')) process.exit(4);
if (!p.operations.some(x=>x.derived&&x.derived.provider==='copy-initial'&&x.derived.item==='src/a.txt')) process.exit(5);
if (p.operations.some(x=>x.derived&&x.derived.provider==='copy-generated'&&x.derived.item)) process.exit(6);
NODE

run_mk --project "$tmp/project" generated || fail "runtime refinement build failed"
for f in out/a.txt out/extra.txt out/g-b.txt out/g-c.txt bundle.txt
 do [ -f "$tmp/project/$f" ] || fail "missing refined output: $f"
done

rm -f "$tmp/project/small.txt" "$tmp/project/large.txt"
run_mk --project "$tmp/project" --plan branch > "$tmp/branch.json" || fail "conditional output plan failed"
node - "$tmp/branch.json" <<'NODE' || fail "output-dependent alternatives were not preserved"
const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
for (const n of ['small','large']) { const x=p.operations.find(y=>y.name===n); if (!x||x.state!=='conditional'||x.when.state!=='unknown'||!x.observes.includes('bundle')) process.exit(1); }
NODE
run_mk --project "$tmp/project" branch || fail "output-dependent branch execution failed"
[ -f "$tmp/project/small.txt" ] && [ ! -e "$tmp/project/large.txt" ] || fail "wrong output-dependent branch selected"

rm -f "$tmp/project/fallback.txt"
run_mk --project "$tmp/project" fallback || fail "result-dependent fallback execution failed"
[ -f "$tmp/project/fallback.txt" ] || fail "fallback branch was not selected after continued failure"

printf x > "$tmp/project/marker"
rm -f "$tmp/project/state-present.txt" "$tmp/project/state-absent.txt"
run_mk --project "$tmp/project" state || fail "state-present execution failed"
[ -f "$tmp/project/state-present.txt" ] && [ ! -e "$tmp/project/state-absent.txt" ] || fail "state-present branch incorrect"
rm -f "$tmp/project/marker" "$tmp/project/state-present.txt" "$tmp/project/state-absent.txt"
run_mk --project "$tmp/project" state || fail "state-absent execution failed"
[ ! -e "$tmp/project/state-present.txt" ] && [ -f "$tmp/project/state-absent.txt" ] || fail "state-absent branch incorrect"

run_mk --project "$tmp/project" --profile release --plan generated > "$tmp/release.json" || fail "profile collection plan failed"
node - "$tmp/release.json" <<'NODE' || fail "profile-specific explicit collection selection failed"
const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const c=p.collections.find(x=>x.name==='initial');
if (!c||JSON.stringify(c.items)!==JSON.stringify(['src/a.txt'])) process.exit(1);
NODE

printf '%s\n' 'PASS poc-016 mk runtime refinement model'
