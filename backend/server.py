#!/usr/bin/env python3
"""
HackerRank Solver Backend
- Receives problem HTML + code from userscript via WebSocket
- Converts HTML to PNG using Playwright
- Sends image + code to Google Gemini API
- Streams the solution back to the userscript
"""

import os
import sys
import json
import base64
import asyncio
import tempfile
import time
import re
from pathlib import Path
from datetime import datetime

from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS

import google.generativeai as genai
from PIL import Image
import io

# ─── Config ───────────────────────────────────────────────────────────────────

CONFIG_FILE = Path(__file__).parent / "config.json"
HISTORY_FILE = Path(__file__).parent / "history.json"
SCREENSHOTS_DIR = Path(__file__).parent / "screenshots"
SCREENSHOTS_DIR.mkdir(exist_ok=True)

DEFAULT_CONFIG = {
    "gemini_api_key": "",
    "gemini_model": "gemini-2.5-flash",
    "typing_speed": 15,  # ms per character
    "auto_solve": False,
    "theme": "dark",
}


def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            saved = json.load(f)
        return {**DEFAULT_CONFIG, **saved}
    return DEFAULT_CONFIG.copy()


def save_config(cfg):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


def load_history():
    if HISTORY_FILE.exists():
        with open(HISTORY_FILE) as f:
            return json.load(f)
    return []


def save_history(history):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history[-100:], f, indent=2)  # Keep last 100


# ─── Flask App ────────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", ping_timeout=60, ping_interval=25)

config = load_config()
history = load_history()

# Track connected clients
clients = {"userscript": set(), "dashboard": set()}


# ─── HTML to Image Conversion ────────────────────────────────────────────────

def html_to_image_playwright(html_content: str) -> bytes:
    """Convert HTML string to PNG bytes using Playwright."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 900, "height": 800})

        # Write HTML to temp file
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as f:
            f.write(html_content)
            tmp_path = f.name

        page.goto(f"file://{tmp_path}")
        page.wait_for_load_state("networkidle", timeout=10000)  # 10s timeout

        # Get actual content height
        height = page.evaluate("document.body.scrollHeight")
        page.set_viewport_size({"width": 900, "height": min(height + 40, 8000)})

        screenshot = page.screenshot(full_page=True, type="png")
        browser.close()
        os.unlink(tmp_path)

        return screenshot


def html_to_image_fallback(html_content: str) -> bytes:
    """Fallback: use imgkit/wkhtmltoimage if available."""
    try:
        import imgkit
        png_bytes = imgkit.from_string(html_content, False, options={
            "width": 900,
            "quality": 90,
            "encoding": "UTF-8",
        })
        return png_bytes
    except Exception:
        pass

    # Last resort: just send the HTML as text to Gemini
    return None


def convert_html_to_image(html_content: str) -> bytes:
    """Try Playwright first, then fallback."""
    try:
        return html_to_image_playwright(html_content)
    except Exception as e:
        print(f"[WARN] Playwright failed: {e}, trying fallback...")
        return html_to_image_fallback(html_content)


# ─── Gemini API ───────────────────────────────────────────────────────────────

def build_prompt(code: str, language: str = "javascript", ninja_mode: bool = False, is_contest: bool = False) -> str:
    style = "\nStyle: simple readable code, no comments, basic variable names." if ninja_mode else ""

    return f"""Solve this HackerRank problem.

Language: {language}{style}

Starter code:
{code}

Return the complete working code. No markdown, no explanation."""


def clean_code(text: str) -> str:
    """Strip markdown fences and whitespace."""
    text = text.strip()
    text = re.sub(r'^```\w*\n?', '', text)
    text = re.sub(r'\n?```\s*$', '', text)
    return text.strip()


def extract_changes(original_code: str, full_solution: str, cfg: dict) -> dict:
    """Second AI call: compare original vs solution and extract only the changed part."""
    try:
        genai.configure(api_key=cfg["gemini_api_key"])
        model = genai.GenerativeModel(cfg.get("gemini_model", "gemini-2.5-flash"))

        prompt = f"""Compare these two code snippets and find what changed.

ORIGINAL CODE:
---
{original_code}
---

SOLUTION CODE:
---
{full_solution}
---

Return EXACTLY in this format:
===FIND===
(copy the exact part from ORIGINAL CODE that was changed/replaced — verbatim, character-for-character)
===REPLACE===
(copy the exact part from SOLUTION CODE that replaces it — verbatim, character-for-character)

Only include the part that actually changed. Do NOT include unchanged imports, boilerplate, stdin/stdout handling, or helper functions."""

        response = model.generate_content(prompt, stream=False)
        text = response.text.strip()

        if '===FIND===' in text and '===REPLACE===' in text:
            after_find = text.split('===FIND===', 1)[1]
            parts = after_find.split('===REPLACE===', 1)
            find = clean_code(parts[0].strip())
            replace = clean_code(parts[1].strip()) if len(parts) > 1 else ''
            if find and replace:
                return {'find': find, 'code': replace}

    except Exception as e:
        print(f"[WARN] extract_changes failed: {e}")

    # Fallback: return full solution, empty find
    return {'find': '', 'code': clean_code(full_solution)}


def solve_with_gemini(image_bytes: bytes | None, html_text: str, code: str, language: str = "javascript", ninja_mode: bool = False, is_contest: bool = False) -> str:
    """Send problem image + code to Gemini and get solution."""
    cfg = load_config()
    api_key = cfg.get("gemini_api_key", "")
    if not api_key:
        raise ValueError("Gemini API key not configured. Set it in the dashboard.")

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(cfg.get("gemini_model", "gemini-2.5-flash"))

    prompt = build_prompt(code, language, ninja_mode, is_contest)

    parts = []
    if image_bytes:
        img = Image.open(io.BytesIO(image_bytes))
        parts.append(img)

    if not image_bytes and html_text:
        prompt = f"""Solve this coding problem:

{html_text[:15000]}

Starter code ({language}):
{code}

Return the complete working code. No markdown, no explanation."""
        parts.append(prompt)
    else:
        parts.append(prompt)

    response = model.generate_content(parts, stream=False)

    # Handle empty response
    if not response.candidates or not response.candidates[0].content.parts:
        simple_prompt = f"Complete this {language} code to solve the problem shown in the image. Return only code, no markdown."
        parts_retry = []
        if image_bytes:
            parts_retry.append(Image.open(io.BytesIO(image_bytes)))
        parts_retry.append(simple_prompt)
        response = model.generate_content(parts_retry, stream=False)

    try:
        raw = response.text.strip()
    except Exception:
        if response.candidates and response.candidates[0].content.parts:
            raw = response.candidates[0].content.parts[0].text.strip()
        else:
            raise ValueError("Gemini returned empty response. Try again or check your API key.")

    return clean_code(raw)


# ─── WebSocket Events ────────────────────────────────────────────────────────

@socketio.on("connect")
def handle_connect():
    print(f"[+] Client connected: {request.sid}")
    emit("connected", {"sid": request.sid, "status": "ok"})


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    for group in clients.values():
        group.discard(sid)
    print(f"[-] Client disconnected: {sid}")
    socketio.emit("client_update", {
        "userscripts": len(clients["userscript"]),
        "dashboards": len(clients["dashboard"]),
    })


@socketio.on("register")
def handle_register(data):
    role = data.get("role", "unknown")
    sid = request.sid
    if role in clients:
        clients[role].add(sid)
    print(f"[*] Registered {role}: {sid}")
    socketio.emit("client_update", {
        "userscripts": len(clients["userscript"]),
        "dashboards": len(clients["dashboard"]),
    })


def do_solve(sid, data):
    """Background task to solve problem without blocking socket."""
    html_content = data.get("html", "")
    code = data.get("code", "")
    language = data.get("language", "javascript")
    problem_title = data.get("title", "Unknown Problem")
    problem_url = data.get("url", "")
    ninja_mode = data.get("ninja_mode", False)
    is_contest = data.get("is_contest", False)

    print(f"\n{'='*60}")
    print(f"[SOLVE] {problem_title}")
    print(f"[URL]   {problem_url}")
    print(f"[LANG]  {language}")
    print(f"[MODE]  {'NINJA' if ninja_mode else 'Normal'}{'  + CONTEST' if is_contest else ''}")
    print(f"[CODE]  {len(code)} chars")
    print(f"[HTML]  {len(html_content)} chars")
    print(f"{'='*60}\n")

    socketio.emit("solve_started", {
        "title": problem_title,
        "url": problem_url,
        "language": language,
        "timestamp": datetime.now().isoformat(),
    })

    socketio.emit("status", {"stage": "converting", "message": "Converting problem to image..."}, to=sid)

    try:
        # Step 1: HTML → Image
        image_bytes = convert_html_to_image(html_content) if html_content else None

        if image_bytes:
            ts = int(time.time())
            ss_path = SCREENSHOTS_DIR / f"{ts}_{problem_title[:40].replace(' ', '_')}.png"
            with open(ss_path, "wb") as f:
                f.write(image_bytes)
            socketio.emit("status", {"stage": "captured", "message": f"Screenshot saved ({len(image_bytes)//1024}KB)"}, to=sid)

            img_b64 = base64.b64encode(image_bytes).decode()
            socketio.emit("problem_screenshot", {"image": img_b64, "title": problem_title})
        else:
            socketio.emit("status", {"stage": "captured", "message": "Using HTML text"}, to=sid)

        # Step 2: Send to Gemini
        mode_msg = "Sending to Gemini AI (ninja mode)..." if ninja_mode else "Sending to Gemini AI..."
        socketio.emit("status", {"stage": "solving", "message": mode_msg}, to=sid)

        full_solution = solve_with_gemini(image_bytes, html_content, code, language, ninja_mode, is_contest)

        print(f"\n[FULL SOLUTION] ({len(full_solution)} chars):\n{full_solution[:200]}...\n")

        # Second AI call: extract only the changed part
        socketio.emit("status", {"stage": "solving", "message": "Extracting changes..."}, to=sid)
        result = extract_changes(code, full_solution, load_config())
        solution = result['code']
        find_text = result['find']

        print(f"[SOLUTION] ({len(solution)} chars):\n{solution[:200]}...")
        if find_text:
            print(f"[FIND] ({len(find_text)} chars):\n{find_text[:200]}...")
        else:
            print("[FIND] Empty — will replace entire editor")
        print()

        # Step 3: Send solution back
        socketio.emit("status", {"stage": "done", "message": "Solution ready!"}, to=sid)
        socketio.emit("solution", {
            "code": solution,
            "find": find_text,
            "title": problem_title,
            "language": language,
        }, to=sid)

        socketio.emit("solve_completed", {
            "title": problem_title,
            "solution_length": len(solution),
            "timestamp": datetime.now().isoformat(),
        })

        entry = {
            "title": problem_title,
            "url": problem_url,
            "language": language,
            "solution_length": len(solution),
            "timestamp": datetime.now().isoformat(),
            "success": True,
        }
        history.append(entry)
        save_history(history)

    except Exception as e:
        error_msg = str(e)
        print(f"[ERROR] {error_msg}")
        socketio.emit("status", {"stage": "error", "message": error_msg}, to=sid)
        socketio.emit("error", {"message": error_msg}, to=sid)
        socketio.emit("solve_error", {
            "title": problem_title,
            "error": error_msg,
            "timestamp": datetime.now().isoformat(),
        })


@socketio.on("solve_problem")
def handle_solve(data):
    """Receive solve request and run in background."""
    print("[DEBUG] solve_problem event received!")
    sid = request.sid
    # Run in background so socket doesn't block
    socketio.start_background_task(do_solve, sid, data)


# ─── REST API ─────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    cfg = load_config()
    # Mask API key for security
    masked = cfg.copy()
    if masked.get("gemini_api_key"):
        key = masked["gemini_api_key"]
        masked["gemini_api_key_masked"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
    return jsonify(masked)


@app.route("/api/config", methods=["POST"])
def update_config():
    global config
    data = request.json
    cfg = load_config()
    cfg.update(data)
    save_config(cfg)
    config = cfg
    return jsonify({"status": "ok", "config": cfg})


@app.route("/api/history", methods=["GET"])
def get_history():
    return jsonify(load_history())


@app.route("/api/history", methods=["DELETE"])
def clear_history():
    global history
    history = []
    save_history(history)
    return jsonify({"status": "cleared"})


@app.route("/api/status", methods=["GET"])
def get_status():
    cfg = load_config()
    return jsonify({
        "running": True,
        "api_key_set": bool(cfg.get("gemini_api_key")),
        "model": cfg.get("gemini_model", "gemini-2.5-flash"),
        "clients": {
            "userscripts": len(clients["userscript"]),
            "dashboards": len(clients["dashboard"]),
        },
    })


@app.route("/api/test-gemini", methods=["POST"])
def test_gemini():
    """Quick test of Gemini API connection."""
    try:
        cfg = load_config()
        genai.configure(api_key=cfg["gemini_api_key"])
        model = genai.GenerativeModel(cfg.get("gemini_model", "gemini-2.5-flash"))
        resp = model.generate_content("Say 'API connection successful!' in exactly those words.")
        return jsonify({"status": "ok", "response": resp.text.strip()})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════╗
║       🧠 HackerRank Solver — Backend Server         ║
║                                                      ║
║  Dashboard:  http://localhost:5055                    ║
║  WebSocket:  ws://localhost:5055                      ║
║                                                      ║
║  1. Open dashboard to set your Gemini API key        ║
║  2. Install the userscript in Tampermonkey           ║
║  3. Open a HackerRank problem and click ⚡ Solve     ║
╚══════════════════════════════════════════════════════╝
""")

    cfg = load_config()
    if not cfg.get("gemini_api_key"):
        print("[!] No Gemini API key set. Visit http://localhost:5055 to configure.\n")

    socketio.run(app, host="0.0.0.0", port=5055, debug=False)
