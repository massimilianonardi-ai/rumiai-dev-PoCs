#!/usr/bin/env python3
"""
Interactive ChatGPT macOS conversation exporter.

What it does
------------
1. Reads the local ChatGPT thread catalog from ~/.codex/sqlite/codex-dev.db.
2. Shows the available ChatGPT conversations as a numbered list.
3. Connects to the ChatGPT Electron renderer through Chrome DevTools Protocol.
4. Arms a breakpoint on the function that receives the complete conversation snapshot.
5. Navigates the app to the selected /work/conversation/<id> route.
6. Captures the selected snapshot from memory.
7. Writes a forensic export named `YYYY-MM-DD title`:
   - conversation.raw.json.gz
   - TRANSCRIPT.md
   - VISIBLE_MESSAGES.jsonl
   - AUDIT.json
   - README.md
   - SHA256SUMS
   - <folder>.zip

No third-party Python packages are required.

Requirement
-----------
ChatGPT must be launched with:
    --remote-debugging-port=9222

Example:
    osascript -e 'quit app "ChatGPT"'
    open -na "/Applications/ChatGPT.app" --args --remote-debugging-port=9222
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
import re
import socket
import sqlite3
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile

from collections import Counter, deque
from datetime import datetime
from pathlib import Path


DEFAULT_DB = Path.home() / ".codex/sqlite/codex-dev.db"
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_PORT = 9222

INTERNAL_CONTENT_TYPES = {"thoughts", "reasoning_recap"}


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_filename(value: str, max_len: int = 160) -> str:
    value = value.replace("/", "-").replace(":", "-")
    value = re.sub(r"[\x00-\x1f]", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    value = value.rstrip(". ")
    if not value:
        value = "Untitled"
    return value[:max_len].rstrip()


def local_date_from_timestamp(ts) -> str:
    """
    Convert the conversation creation timestamp to local YYYY-MM-DD.

    ChatGPT normally stores seconds since Unix epoch. Millisecond timestamps
    are accepted defensively as well.
    """
    try:
        if ts is None:
            raise ValueError

        value = float(ts)
        if value > 10_000_000_000:
            value /= 1000.0

        return datetime.fromtimestamp(value).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().strftime("%Y-%m-%d")

def format_timestamp(ts) -> str:
    try:
        if ts is None:
            return "-"
        return datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return "-"


def unique_directory(root: Path, preferred_name: str) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    candidate = root / preferred_name
    if not candidate.exists():
        return candidate

    n = 2
    while True:
        candidate = root / f"{preferred_name} ({n})"
        if not candidate.exists():
            return candidate
        n += 1


# ---------------------------------------------------------------------------
# Local conversation catalog
# ---------------------------------------------------------------------------

def load_conversations(db_path: Path):
    if not db_path.exists():
        raise RuntimeError(f"Catalogo locale non trovato: {db_path}")

    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row

    try:
        rows = conn.execute(
            """
            SELECT
                thread_id,
                display_title,
                source_created_at,
                source_updated_at,
                host_id,
                source_kind
            FROM local_thread_catalog
            WHERE source_kind = 'chatgpt'
               OR host_id LIKE 'chatgpt:%'
            ORDER BY source_updated_at DESC, source_created_at DESC
            """
        ).fetchall()
    except sqlite3.Error as e:
        raise RuntimeError(
            "Impossibile leggere local_thread_catalog. "
            "La struttura del database potrebbe essere cambiata."
        ) from e
    finally:
        conn.close()

    # Deduplicate by conversation ID while keeping the most recent row.
    seen = set()
    result = []
    for row in rows:
        cid = row["thread_id"]
        if cid in seen:
            continue
        seen.add(cid)
        result.append(dict(row))

    return result


def choose_conversation(conversations, forced_id: str | None):
    if forced_id:
        for c in conversations:
            if c["thread_id"] == forced_id:
                return c
        return {
            "thread_id": forced_id,
            "display_title": forced_id,
            "source_created_at": None,
            "source_updated_at": None,
            "host_id": None,
            "source_kind": "chatgpt",
        }

    if not conversations:
        raise RuntimeError("Nessuna conversazione ChatGPT trovata nel catalogo locale.")

    print()
    print("Conversazioni ChatGPT")
    print("=" * 80)

    for i, c in enumerate(conversations, 1):
        title = c.get("display_title") or "(senza titolo)"
        updated = format_timestamp(c.get("source_updated_at"))
        print(f"{i:3d}. {updated}  {title}")

    print()
    while True:
        value = input("Numero della chat da esportare (q per uscire): ").strip()
        if value.lower() in {"q", "quit", "exit"}:
            raise SystemExit(0)

        try:
            n = int(value)
        except ValueError:
            print("Inserisci un numero valido.")
            continue

        if 1 <= n <= len(conversations):
            return conversations[n - 1]

        print("Numero fuori intervallo.")


# ---------------------------------------------------------------------------
# Minimal WebSocket client for Chrome DevTools Protocol
# ---------------------------------------------------------------------------

class WebSocket:
    def __init__(self, url: str):
        u = urllib.parse.urlparse(url)
        host = u.hostname
        port = u.port or 80

        self.sock = socket.create_connection((host, port))
        self.buffer = b""

        key = base64.b64encode(os.urandom(16)).decode("ascii")

        request = (
            f"GET {u.path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )

        self.sock.sendall(request.encode("ascii"))

        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("WebSocket chiuso durante l'handshake.")
            response += chunk

        headers, rest = response.split(b"\r\n\r\n", 1)
        if b" 101 " not in headers:
            raise RuntimeError(
                "Handshake WebSocket fallito:\n"
                + headers.decode("utf-8", "replace")
            )

        self.buffer = rest

    def _recv_exact(self, n: int) -> bytes:
        out = b""

        if self.buffer:
            take = min(n, len(self.buffer))
            out = self.buffer[:take]
            self.buffer = self.buffer[take:]

        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise EOFError("Connessione WebSocket chiusa.")
            out += chunk

        return out

    def _send_control(self, opcode: int, payload: bytes = b""):
        n = len(payload)
        if n >= 126:
            raise RuntimeError("Control frame WebSocket troppo grande.")

        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes([0x80 | opcode, 0x80 | n]) + mask + masked)

    def send_text(self, text: str):
        payload = text.encode("utf-8")
        n = len(payload)
        first = 0x81
        mask_bit = 0x80

        if n < 126:
            header = bytes([first, mask_bit | n])
        elif n < 65536:
            header = bytes([first, mask_bit | 126]) + struct.pack("!H", n)
        else:
            header = bytes([first, mask_bit | 127]) + struct.pack("!Q", n)

        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def recv_text(self) -> str:
        fragments = []

        while True:
            b1, b2 = self._recv_exact(2)

            fin = bool(b1 & 0x80)
            opcode = b1 & 0x0F
            masked = bool(b2 & 0x80)
            n = b2 & 0x7F

            if n == 126:
                n = struct.unpack("!H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._recv_exact(8))[0]

            mask = self._recv_exact(4) if masked else None
            payload = self._recv_exact(n)

            if masked:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))

            if opcode == 0x8:
                raise EOFError("WebSocket chiuso dal renderer.")

            if opcode == 0x9:  # ping
                self._send_control(0xA, payload)
                continue

            if opcode == 0x1:
                fragments = [payload]
            elif opcode == 0x0:
                fragments.append(payload)
            else:
                continue

            if fin:
                return b"".join(fragments).decode("utf-8")


class CDP:
    def __init__(self, websocket_url: str):
        self.ws = WebSocket(websocket_url)
        self.next_id = 0
        self.events = deque()
        self.responses = {}

    def _recv_json(self):
        return json.loads(self.ws.recv_text())

    def call(self, method: str, params=None):
        self.next_id += 1
        wanted = self.next_id

        payload = {"id": wanted, "method": method}
        if params is not None:
            payload["params"] = params

        self.ws.send_text(json.dumps(payload, separators=(",", ":")))

        if wanted in self.responses:
            msg = self.responses.pop(wanted)
            return self._unwrap(method, msg)

        while True:
            msg = self._recv_json()

            if "id" in msg:
                mid = msg["id"]
                if mid == wanted:
                    return self._unwrap(method, msg)
                self.responses[mid] = msg
            else:
                self.events.append(msg)

    @staticmethod
    def _unwrap(method, msg):
        if "error" in msg:
            raise RuntimeError(f"{method}: {msg['error']}")
        return msg.get("result", {})

    def next_event(self):
        if self.events:
            return self.events.popleft()

        while True:
            msg = self._recv_json()
            if "id" in msg:
                self.responses[msg["id"]] = msg
                continue
            return msg


# ---------------------------------------------------------------------------
# Renderer discovery and breakpoint discovery
# ---------------------------------------------------------------------------

def get_renderer(port: int):
    url = f"http://127.0.0.1:{port}/json/list"

    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            targets = json.load(r)
    except Exception as e:
        raise RuntimeError(
            f"Chrome DevTools Protocol non disponibile su 127.0.0.1:{port}.\n\n"
            "Avvia ChatGPT così:\n"
            '  osascript -e \'quit app "ChatGPT"\'\n'
            f'  open -na "/Applications/ChatGPT.app" --args --remote-debugging-port={port}'
        ) from e

    preferred = [
        t for t in targets
        if t.get("type") == "page"
        and t.get("url") == "app://-/index.html"
    ]

    if not preferred:
        preferred = [
            t for t in targets
            if t.get("type") == "page"
            and str(t.get("url", "")).startswith("app://-/index.html")
            and "avatar-overlay" not in str(t.get("url", ""))
        ]

    if not preferred:
        raise RuntimeError("Renderer principale ChatGPT non trovato.")

    return preferred[0]


def split_top_level_params(params: str):
    parts = []
    current = []
    depth = 0

    pairs = {"{": "}", "[": "]", "(": ")"}
    opens = set(pairs)
    closes = set(pairs.values())

    for ch in params:
        if ch in opens:
            depth += 1
        elif ch in closes:
            depth -= 1

        if ch == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(ch)

    parts.append("".join(current).strip())
    return parts


def line_column(source: str, offset: int):
    before = source[:offset]
    line = before.count("\n")
    last_nl = before.rfind("\n")
    column = offset if last_nl < 0 else offset - last_nl - 1
    return line, column


def discover_snapshot_function(cdp: CDP):
    cdp.call("Runtime.enable")
    cdp.call("Debugger.enable")

    # Forces delivery of the already-existing scriptParsed event stream.
    cdp.call("Runtime.evaluate", {"expression": "1", "returnByValue": True})

    scripts = {}

    # All scriptParsed events received before the Runtime.evaluate response
    # are already queued. Drain those without waiting for new events.
    while cdp.events:
        event = cdp.events.popleft()
        if event.get("method") == "Debugger.scriptParsed":
            p = event["params"]
            scripts[p["scriptId"]] = p.get("url", "")

    candidates = [
        (sid, url)
        for sid, url in scripts.items()
        if url.startswith("app://") and ".js" in url
    ]

    def priority(item):
        url = item[1]
        if "app-initial" in url:
            return 0
        if "conversation" in url:
            return 1
        return 2

    candidates.sort(key=priority)

    # We intentionally search a semantic marker rather than the minified
    # function name (which may change between app builds).
    for sid, url in candidates:
        try:
            source = cdp.call(
                "Debugger.getScriptSource",
                {"scriptId": sid}
            ).get("scriptSource", "")
        except Exception:
            continue

        marker_pos = source.find("mergeActiveBranch")
        while marker_pos >= 0:
            window_start = max(0, marker_pos - 500)
            window = source[window_start: marker_pos + 250]

            matches = list(re.finditer(
                r"function\s+([A-Za-z_$][A-Za-z0-9_$]*)\((.*?)\)\{",
                window,
                re.S,
            ))

            for match in reversed(matches):
                params = match.group(2)
                if "mergeActiveBranch" not in params:
                    continue

                pieces = split_top_level_params(params)
                if len(pieces) < 2:
                    continue

                second_arg = pieces[1]
                if not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", second_arg):
                    continue

                body_offset = window_start + match.end()
                line, column = line_column(source, body_offset)

                return {
                    "function_name": match.group(1),
                    "conversation_arg": second_arg,
                    "script_id": sid,
                    "url": url,
                    "line": line,
                    "column": column,
                }

            marker_pos = source.find("mergeActiveBranch", marker_pos + 1)

    raise RuntimeError(
        "Non trovo la funzione che applica il conversation snapshot. "
        "Probabilmente ChatGPT è stato aggiornato e il bundle è cambiato."
    )


# ---------------------------------------------------------------------------
# Snapshot capture
# ---------------------------------------------------------------------------

def evaluate_on_frame(cdp: CDP, frame_id: str, expression: str):
    return cdp.call(
        "Debugger.evaluateOnCallFrame",
        {
            "callFrameId": frame_id,
            "expression": expression,
            "returnByValue": True,
            "silent": True,
        },
    )


def capture_snapshot(cdp: CDP, selected, hook):
    cid = selected["thread_id"]

    # Use a URL breakpoint so it remains valid if navigation reloads the
    # renderer and the script gets a new scriptId.
    bp = cdp.call(
        "Debugger.setBreakpointByUrl",
        {
            "url": hook["url"],
            "lineNumber": hook["line"],
            "columnNumber": hook["column"],
        },
    )

    print()
    print("Breakpoint armato:", bp.get("breakpointId"))
    print("Conversazione:", selected.get("display_title"))
    print("ID:", cid)

    cdp.call("Page.enable")

    route = f"/work/conversation/{cid}"
    target_url = "app://-/index.html?initialRoute=" + urllib.parse.quote(
        route, safe=""
    )

    print("Apro automaticamente la conversazione nell'app...")

    try:
        cdp.call("Page.navigate", {"url": target_url})
    except Exception as e:
        print("Navigazione automatica non riuscita:", e)
        print("Apri manualmente nell'app la conversazione indicata sopra.")

    # Give focus to ChatGPT. This is not required for capture, but makes the
    # selected route visible to the user.
    try:
        subprocess.run(
            ["osascript", "-e", 'tell application "ChatGPT" to activate'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass

    print("Attendo lo snapshot della conversazione...")
    print("(Se la navigazione automatica non cambia chat, aprila manualmente.)")

    arg = hook["conversation_arg"]

    while True:
        event = cdp.next_event()

        if event.get("method") != "Debugger.paused":
            continue

        frames = event.get("params", {}).get("callFrames", [])
        matched = False
        raw_json = None

        for frame in frames:
            frame_id = frame["callFrameId"]

            try:
                result = evaluate_on_frame(
                    cdp,
                    frame_id,
                    f"{arg} && {arg}.conversation_id"
                )
                value = result.get("result", {}).get("value")
            except Exception:
                continue

            if value != cid:
                continue

            result = evaluate_on_frame(
                cdp,
                frame_id,
                f"JSON.stringify({arg})"
            )
            raw_json = result.get("result", {}).get("value")

            if not isinstance(raw_json, str):
                raise RuntimeError("Impossibile serializzare il conversation snapshot.")

            matched = True
            break

        cdp.call("Debugger.resume")

        if matched:
            return raw_json


# ---------------------------------------------------------------------------
# Transcript extraction
# ---------------------------------------------------------------------------

def textual_fragments(content):
    fragments = []
    non_text = []

    parts = content.get("parts")
    if isinstance(parts, list):
        for i, part in enumerate(parts):
            if isinstance(part, str):
                fragments.append(part)
            else:
                non_text.append({"part_index": i, "part": part})

    if not fragments:
        for key in ("text", "code"):
            value = content.get(key)
            if isinstance(value, str):
                fragments.append(value)
                break

    return fragments, non_text


def classify_message(msg):
    role = (msg.get("author") or {}).get("role")
    channel = msg.get("channel")
    recipient = msg.get("recipient")
    content = msg.get("content") or {}
    ctype = content.get("content_type")

    if role == "tool":
        return False, "tool_traffic"

    if role not in {"user", "assistant"}:
        return False, f"internal_role:{role}"

    if ctype in INTERNAL_CONTENT_TYPES:
        return False, "internal_reasoning"

    if role == "assistant":
        if channel == "analysis":
            return False, "assistant_analysis"
        if recipient not in (None, "", "all"):
            return False, "assistant_tool_invocation"

    # User/assistant message that is not classified as internal.
    return True, "visible_candidate"


def export_snapshot(raw_json: str, selected, output_root: Path):
    raw_bytes = raw_json.encode("utf-8")
    data = json.loads(raw_json)

    mapping = data.get("mapping") or {}
    current = data.get("current_node")

    node_ids = []
    seen = set()
    nid = current

    while nid:
        if nid in seen:
            raise RuntimeError(f"Ciclo rilevato nella conversazione: {nid}")
        seen.add(nid)
        node_ids.append(nid)

        if nid not in mapping:
            raise RuntimeError(f"Parent chain interrotta: nodo {nid} non presente.")
        nid = mapping[nid].get("parent")

    node_ids.reverse()

    title = data.get("title") or selected.get("display_title") or data.get("conversation_id")
    # Canonical exported name: YYYY-MM-DD title.
    # Prefer the snapshot's own create_time: it is the authoritative
    # start date of the conversation.
    chat_started_at = data.get("create_time")
    if chat_started_at is None:
        chat_started_at = selected.get("source_created_at")

    date = local_date_from_timestamp(chat_started_at)
    folder_name = f"{date} {safe_filename(title)}"
    outdir = unique_directory(output_root, folder_name)
    outdir.mkdir(parents=True)

    raw_gz = outdir / "conversation.raw.json.gz"
    transcript = outdir / "TRANSCRIPT.md"
    visible_jsonl = outdir / "VISIBLE_MESSAGES.jsonl"
    audit_path = outdir / "AUDIT.json"
    non_text_path = outdir / "NON_TEXT_PARTS.json"
    readme = outdir / "README.md"
    sums_path = outdir / "SHA256SUMS"

    # Deterministic gzip (mtime=0).
    with raw_gz.open("wb") as raw_file:
        with gzip.GzipFile(
            filename="",
            mode="wb",
            fileobj=raw_file,
            compresslevel=9,
            mtime=0,
        ) as gz:
            gz.write(raw_bytes)

    visible = []
    audit_rows = []
    non_text_parts = []
    counts = Counter()

    for ordinal, node_id in enumerate(node_ids):
        node = mapping[node_id]
        msg = node.get("message")

        if not msg:
            counts["no_message"] += 1
            audit_rows.append({
                "ordinal": ordinal,
                "node_id": node_id,
                "classification": "no_message",
                "included": False,
            })
            continue

        role = (msg.get("author") or {}).get("role")
        channel = msg.get("channel")
        recipient = msg.get("recipient")
        content = msg.get("content") or {}
        ctype = content.get("content_type")

        include, classification = classify_message(msg)
        fragments, non_text = textual_fragments(content)
        text = "".join(fragments)

        # Empty technical assistant nodes should not become empty transcript
        # turns unless they carry non-text visible content.
        if include and role == "assistant" and not text and not non_text:
            include = False
            classification = "empty_assistant_node"

        counts[classification] += 1

        audit_rows.append({
            "ordinal": ordinal,
            "node_id": node_id,
            "message_id": msg.get("id"),
            "role": role,
            "channel": channel,
            "recipient": recipient,
            "content_type": ctype,
            "classification": classification,
            "included": include,
            "text_length": len(text),
            "non_text_parts": len(non_text),
        })

        if not include:
            continue

        item = {
            "ordinal": ordinal,
            "node_id": node_id,
            "parent": node.get("parent"),
            "message_id": msg.get("id"),
            "role": role,
            "channel": channel,
            "recipient": recipient,
            "content_type": ctype,
            "create_time": msg.get("create_time"),
            "text": text,
            # Preserve the full visible message object for multimodal metadata,
            # citations, attachment pointers and future content types.
            "message": msg,
        }
        visible.append(item)

        for entry in non_text:
            non_text_parts.append({
                "ordinal": ordinal,
                "node_id": node_id,
                "message_id": msg.get("id"),
                "role": role,
                "content_type": ctype,
                **entry,
            })

    # Machine-readable visible messages.
    with visible_jsonl.open("w", encoding="utf-8", newline="\n") as f:
        for item in visible:
            f.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
            f.write("\n")

    # Human-readable text transcript.
    with transcript.open("w", encoding="utf-8", newline="\n") as f:
        f.write(f"# {title}\n\n")
        f.write(f"Conversation ID: `{data.get('conversation_id', '')}`\n\n")
        f.write(
            "<!-- Derived from a captured ChatGPT conversation snapshot. -->\n"
            "<!-- Text strings are not stripped, rewritten or normalized. -->\n"
            "<!-- Non-text multimodal parts are preserved in VISIBLE_MESSAGES.jsonl "
            "and NON_TEXT_PARTS.json. -->\n\n"
        )

        for item in visible:
            role = item["role"]
            channel = item.get("channel")

            if role == "user":
                heading = "USER"
            elif channel == "commentary":
                heading = "ASSISTANT — commentary"
            else:
                heading = "ASSISTANT"

            f.write(f"## {heading}\n\n")

            if item["text"]:
                f.write(item["text"])
            else:
                f.write("[contenuto non testuale; vedi VISIBLE_MESSAGES.jsonl]")

            f.write("\n\n")

    non_text_path.write_text(
        json.dumps(non_text_parts, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    audit = {
        "source": {
            "kind": "ChatGPT renderer conversation snapshot captured via CDP",
            "raw_uncompressed_bytes": len(raw_bytes),
            "raw_sha256": sha256_bytes(raw_bytes),
        },
        "conversation": {
            "title": title,
            "conversation_id": data.get("conversation_id"),
            "create_time": data.get("create_time"),
            "update_time": data.get("update_time"),
            "current_node": current,
            "mapping_nodes": len(mapping),
            "active_branch_nodes": len(node_ids),
            "nodes_outside_active_branch": len(mapping) - len(node_ids),
        },
        "transcript": {
            "visible_messages": len(visible),
            "visible_user_messages": sum(x["role"] == "user" for x in visible),
            "visible_assistant_messages": sum(x["role"] == "assistant" for x in visible),
            "non_text_parts": len(non_text_parts),
            "classification_counts": dict(counts),
        },
        "nodes": audit_rows,
    }

    audit_path.write_text(
        json.dumps(audit, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    readme.write_text(
        f"""# ChatGPT conversation export

Title: `{title}`

Conversation ID: `{data.get("conversation_id")}`

## Files

- `conversation.raw.json.gz`: complete captured conversation snapshot, compressed.
- `TRANSCRIPT.md`: human-readable textual conversation.
- `VISIBLE_MESSAGES.jsonl`: all messages classified as user-visible, including their full message objects.
- `NON_TEXT_PARTS.json`: non-string multimodal parts extracted from visible messages.
- `AUDIT.json`: classification of every node in the snapshot.
- `SHA256SUMS`: integrity hashes.

## Snapshot

- RAW uncompressed bytes: {len(raw_bytes)}
- RAW SHA-256: `{sha256_bytes(raw_bytes)}`
- Mapping nodes: {len(mapping)}
- Active-branch nodes: {len(node_ids)}
- Nodes outside active branch: {len(mapping) - len(node_ids)}
- Visible messages: {len(visible)}
- Non-text visible parts: {len(non_text_parts)}

`TRANSCRIPT.md` excludes tool traffic and internal reasoning. The complete
captured snapshot remains preserved in `conversation.raw.json.gz`.
""",
        encoding="utf-8",
    )

    files_to_hash = [
        raw_gz,
        transcript,
        visible_jsonl,
        non_text_path,
        audit_path,
        readme,
    ]

    with sums_path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(
            f"{sha256_bytes(raw_bytes)}  conversation.raw.json "
            "(uncompressed captured snapshot)\n"
        )
        for p in files_to_hash:
            f.write(f"{sha256_bytes(p.read_bytes())}  {p.name}\n")

    zip_path = outdir.with_suffix(".zip")
    with zipfile.ZipFile(
        zip_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as z:
        for p in [
            raw_gz,
            transcript,
            visible_jsonl,
            non_text_path,
            audit_path,
            readme,
            sums_path,
        ]:
            z.write(p, arcname=p.name)

    return {
        "outdir": outdir,
        "zip": zip_path,
        "title": title,
        "conversation_id": data.get("conversation_id"),
        "raw_bytes": len(raw_bytes),
        "raw_sha256": sha256_bytes(raw_bytes),
        "mapping_nodes": len(mapping),
        "active_nodes": len(node_ids),
        "visible_messages": len(visible),
        "non_text_parts": len(non_text_parts),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(
        description="Esporta una conversazione ChatGPT dal client macOS."
    )
    p.add_argument(
        "output_dir",
        nargs="?",
        type=Path,
        help=(
            "Cartella in cui salvare gli export. "
            "Se omessa, viene usata la cartella dello script."
        ),
    )
    p.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Porta CDP (default: {DEFAULT_PORT})",
    )
    p.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help=f"Database catalogo chat (default: {DEFAULT_DB})",
    )
    p.add_argument(
        "--output",
        dest="output_option",
        type=Path,
        help=(
            "Alias per specificare la cartella di export. "
            "Se presenti entrambi, --output ha precedenza."
        ),
    )
    p.add_argument(
        "--id",
        dest="conversation_id",
        help="Esporta direttamente questo conversation ID senza menu.",
    )

    args = p.parse_args()

    if args.output_option is not None:
        args.output = args.output_option.expanduser()
    elif args.output_dir is not None:
        args.output = args.output_dir.expanduser()
    else:
        args.output = SCRIPT_DIR

    return args

def main():
    args = parse_args()

    try:
        conversations = load_conversations(args.db)
        selected = choose_conversation(conversations, args.conversation_id)

        print()
        print("Selezionata:")
        print(" ", selected.get("display_title"))
        print(" ", selected.get("thread_id"))

        renderer = get_renderer(args.port)
        print()
        print("Renderer:", renderer.get("url"))

        cdp = CDP(renderer["webSocketDebuggerUrl"])

        print("Analizzo il bundle ChatGPT...")
        hook = discover_snapshot_function(cdp)

        print(
            "Hook trovato:",
            hook["function_name"],
            f"({Path(hook['url']).name}:{hook['line'] + 1})",
        )

        raw_json = capture_snapshot(cdp, selected, hook)

        print()
        print("Snapshot acquisito. Creo l'export...")

        result = export_snapshot(raw_json, selected, args.output)

        print()
        print("=" * 80)
        print("EXPORT COMPLETATO")
        print("=" * 80)
        print("Titolo:", result["title"])
        print("Conversation ID:", result["conversation_id"])
        print("RAW bytes:", result["raw_bytes"])
        print("RAW SHA-256:", result["raw_sha256"])
        print("Mapping nodes:", result["mapping_nodes"])
        print("Active nodes:", result["active_nodes"])
        print("Visible messages:", result["visible_messages"])
        print("Non-text parts:", result["non_text_parts"])
        print()
        print("Cartella:")
        print(" ", result["outdir"])
        print("Archivio ZIP:")
        print(" ", result["zip"])

    except KeyboardInterrupt:
        print("\nInterrotto.", file=sys.stderr)
        return 130
    except Exception as e:
        print(f"\nERRORE: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
