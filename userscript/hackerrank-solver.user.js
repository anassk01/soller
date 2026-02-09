// ==UserScript==
// @name         HackerRank AI Solver
// @namespace    https://hackerrank.com
// @version      3.0
// @description  Capture HackerRank problems, solve with Gemini AI, auto-type solutions into editor
// @match        https://www.hackerrank.com/challenges/*/problem*
// @match        https://www.hackerrank.com/contests/*/challenges/*/problem*
// @match        https://www.hackerrank.com/contests/*/challenges/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.4/socket.io.min.js
// ==/UserScript==

(function () {
  'use strict';

  const SERVER_URL = 'http://localhost:5055';

  // State
  let socket = null;
  let isConnected = false;
  let isSolving = false;
  let typingSpeed = 15;

  // NINJA MODE STATE
  let ninjaMode = false;
  let ninjaSolution = null;      // Buffered solution waiting to be typed
  let ninjaTypingIndex = 0;      // Current position in solution
  let ninjaFindText = '';        // Text to find in editor for replacement
  let ninjaIsHoldingKey = false; // Is the user currently holding Ctrl+Shift+W
  let ninjaTypingActive = false; // Typing loop running

  // Inject Styles
  const style = document.createElement('style');
  style.textContent = `
    #hr-solver-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    #hr-solver-panel.ninja-hidden {
      display: none !important;
    }

    #hr-solver-status {
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      padding: 12px 16px;
      color: #e0e0e0;
      font-size: 12px;
      min-width: 220px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      display: none;
      flex-direction: column;
      gap: 8px;
      backdrop-filter: blur(10px);
    }

    #hr-solver-status.show { display: flex; }

    .hr-status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .hr-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ff4757;
      margin-right: 6px;
      flex-shrink: 0;
    }

    .hr-status-dot.on {
      background: #00e676;
      box-shadow: 0 0 8px #00e676;
    }

    .hr-status-msg {
      font-size: 11px;
      color: #888;
      padding: 6px 8px;
      background: #0d0d1a;
      border-radius: 6px;
      display: none;
    }

    .hr-status-msg.show { display: block; }

    .hr-progress {
      height: 3px;
      background: #2a2a4a;
      border-radius: 2px;
      overflow: hidden;
      display: none;
    }

    .hr-progress.show { display: block; }

    .hr-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #00e676, #3b82f6);
      border-radius: 2px;
      width: 0%;
      transition: width 0.5s ease;
    }

    #hr-solve-btn {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: 2px solid #00e676;
      background: #0d0d1a;
      color: #00e676;
      font-size: 22px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0, 230, 118, 0.15);
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    #hr-solve-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 4px 24px rgba(0, 230, 118, 0.3);
      background: #00e67615;
    }

    #hr-solve-btn.solving {
      border-color: #ffa502;
      color: #ffa502;
      animation: hr-spin 1.5s linear infinite;
    }

    #hr-solve-btn.error {
      border-color: #ff4757;
      color: #ff4757;
    }

    #hr-solve-btn.done {
      border-color: #00e676;
      color: #00e676;
    }

    @keyframes hr-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    #hr-solve-btn .btn-text {
      animation: none;
    }

    #hr-solve-btn.solving .btn-text {
      animation: hr-spin 1.5s linear infinite reverse;
    }
  `;
  document.head.appendChild(style);

  // UI
  const panel = document.createElement('div');
  panel.id = 'hr-solver-panel';
  panel.innerHTML = `
    <div id="hr-solver-status">
      <div class="hr-status-row">
        <div style="display:flex;align-items:center">
          <span class="hr-status-dot" id="hr-conn-dot"></span>
          <span id="hr-conn-label">Disconnected</span>
        </div>
        <span style="font-size:10px;color:#666" id="hr-model-label">-</span>
      </div>
      <div class="hr-status-msg" id="hr-status-msg"></div>
      <div class="hr-progress" id="hr-progress">
        <div class="hr-progress-bar" id="hr-progress-bar"></div>
      </div>
    </div>
    <button id="hr-solve-btn" title="Solve with AI">
      <span class="btn-text">S</span>
    </button>
  `;
  document.body.appendChild(panel);

  const solveBtn = document.getElementById('hr-solve-btn');
  const statusPanel = document.getElementById('hr-solver-status');
  const connDot = document.getElementById('hr-conn-dot');
  const connLabel = document.getElementById('hr-conn-label');
  const statusMsg = document.getElementById('hr-status-msg');
  const progressEl = document.getElementById('hr-progress');
  const progressBar = document.getElementById('hr-progress-bar');
  const modelLabel = document.getElementById('hr-model-label');

  // Toggle status panel
  solveBtn.addEventListener('mouseenter', () => {
    statusPanel.classList.add('show');
  });

  panel.addEventListener('mouseleave', () => {
    if (!isSolving) statusPanel.classList.remove('show');
  });

  function setStatus(msg, progress = -1) {
    statusMsg.textContent = msg;
    statusMsg.classList.add('show');
    statusPanel.classList.add('show');
    if (progress >= 0) {
      progressEl.classList.add('show');
      progressBar.style.width = progress + '%';
    }
  }

  function clearStatus() {
    statusMsg.classList.remove('show');
    progressEl.classList.remove('show');
  }

  // NINJA MODE FUNCTIONS
  function toggleNinjaMode() {
    ninjaMode = !ninjaMode;
    if (ninjaMode) {
      panel.classList.add('ninja-hidden');
      console.log('[HR-Solver] NINJA MODE: ON - UI hidden');
      console.log('[HR-Solver] Controls:');
      console.log('  Ctrl+Shift+S = Scan & fetch solution');
      console.log('  Hold SPACE = Type while holding (only after solution ready)');
      console.log('  Ctrl+Shift+N = Exit ninja mode');
    } else {
      panel.classList.remove('ninja-hidden');
      console.log('[HR-Solver] NINJA MODE: OFF - UI visible');
      ninjaSolution = null;
      ninjaFindText = '';
      ninjaTypingIndex = 0;
    }
  }

  // Human-like random delay (variable typing speed with occasional pauses)
  function humanDelay() {
    // Base typing: 80-200ms per character (human medium speed)
    let delay = 80 + Math.random() * 120;

    // 5% chance of a short pause (thinking)
    if (Math.random() < 0.05) {
      delay += 200 + Math.random() * 400;
    }

    // 1% chance of a longer pause (reading/thinking harder)
    if (Math.random() < 0.01) {
      delay += 500 + Math.random() * 1000;
    }

    return delay;
  }

  // Type next character in ninja mode (only when key held)
  async function ninjaTypeLoop() {
    if (ninjaTypingActive) return;
    ninjaTypingActive = true;

    try {
      // Detect editor type
      const cmEl = document.querySelector('.CodeMirror');
      const cm = cmEl && cmEl.CodeMirror;
      const hasMonaco = window.monaco && window.monaco.editor;

      if (!cm && !hasMonaco) {
        console.error('[HR-Solver] No editor found');
        ninjaTypingActive = false;
        return;
      }

      // On first char, clear the target area using findText from AI
      if (ninjaTypingIndex === 0) {
        if (cm) {
          if (ninjaFindText) {
            const content = cm.getValue();
            const idx = content.indexOf(ninjaFindText);
            if (idx !== -1) {
              const from = cm.posFromIndex(idx);
              const to = cm.posFromIndex(idx + ninjaFindText.length);
              cm.replaceRange('', from, to);
              cm.setCursor(from);
            } else {
              cm.setValue('');
              cm.setCursor(0, 0);
            }
          } else {
            cm.setValue('');
            cm.setCursor(0, 0);
          }
          cm.focus();
        } else {
          const model = window.monaco.editor.getModels()[0];
          const editor = window.monaco.editor.getEditors()[0];

          let targetRange;

          if (ninjaFindText) {
            const content = model.getValue();
            const idx = content.indexOf(ninjaFindText);
            if (idx !== -1) {
              const startPos = model.getPositionAt(idx);
              const endPos = model.getPositionAt(idx + ninjaFindText.length);
              targetRange = new window.monaco.Range(
                startPos.lineNumber, startPos.column,
                endPos.lineNumber, endPos.column
              );
            }
          }

          if (!targetRange) {
            const lineCount = model.getLineCount();
            const lastLineLength = model.getLineMaxColumn(lineCount);
            targetRange = new window.monaco.Range(1, 1, lineCount, lastLineLength);
          }

          editor.executeEdits('hr-solver', [{
            range: targetRange,
            text: '',
          }]);

          const startPos = targetRange.getStartPosition();
          editor.setPosition(startPos);
          editor.focus();
        }
      }

      // Type while key is held
      const chars = ninjaSolution.split('');

      while (ninjaIsHoldingKey && ninjaTypingIndex < chars.length) {
        const char = chars[ninjaTypingIndex];

        if (cm) {
          const cursor = cm.getCursor();
          cm.replaceRange(char, cursor);
        } else {
          const editor = window.monaco.editor.getEditors()[0];
          const pos = editor.getPosition();
          const range = new window.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);

          editor.executeEdits('hr-solver', [{
            range: range,
            text: char,
          }]);

          if (char === '\n') {
            editor.setPosition({ lineNumber: pos.lineNumber + 1, column: 1 });
          } else {
            editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
          }

          editor.revealPositionInCenter(editor.getPosition());
        }

        ninjaTypingIndex++;
        await sleep(humanDelay());
      }

      // Check if done
      if (ninjaTypingIndex >= chars.length) {
        console.log('[HR-Solver] Ninja typing complete!');
        ninjaSolution = null;
        ninjaTypingIndex = 0;
      }

    } catch (e) {
      console.error('[HR-Solver] Ninja typing error:', e);
    }

    ninjaTypingActive = false;
  }

  // WebSocket Connection
  function connectToServer() {
    try {
      socket = io(SERVER_URL, {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity,
        upgrade: true,
        timeout: 60000,
        pingTimeout: 60000,
        pingInterval: 25000,
      });

      socket.on('connect', () => {
        isConnected = true;
        connDot.classList.add('on');
        connLabel.textContent = 'Connected';
        socket.emit('register', { role: 'userscript' });
        console.log('[HR-Solver] Connected to server');

        fetch(`${SERVER_URL}/api/config`)
          .then(r => r.json())
          .then(cfg => {
            modelLabel.textContent = cfg.gemini_model || '';
            typingSpeed = cfg.typing_speed || 15;
          })
          .catch(() => {});
      });

      socket.on('disconnect', () => {
        isConnected = false;
        connDot.classList.remove('on');
        connLabel.textContent = 'Disconnected';
        console.log('[HR-Solver] Disconnected');
      });

      socket.on('status', (data) => {
        console.log('[HR-Solver] Status:', data);
        if (!ninjaMode) {
          const stages = { converting: 25, captured: 40, solving: 60, done: 100, error: 0 };
          setStatus(data.message, stages[data.stage] || 50);
        }

        if (data.stage === 'error') {
          solveBtn.className = 'error';
          solveBtn.querySelector('.btn-text').textContent = 'X';
          isSolving = false;
          setTimeout(() => {
            solveBtn.className = '';
            solveBtn.querySelector('.btn-text').textContent = 'S';
            clearStatus();
          }, 3000);
        }
      });

      socket.on('solution', (data) => {
        console.log('[HR-Solver] Solution received:', data.code.length, 'chars');
        isSolving = false;

        if (ninjaMode) {
          // NINJA MODE: Buffer solution for manual typing
          ninjaSolution = data.code;
          ninjaFindText = data.find || '';
          ninjaTypingIndex = 0;
          console.log('[HR-Solver] NINJA: Solution ready! Hold Ctrl+Shift+W to type');
        } else {
          // Normal mode: auto-type
          setStatus('Typing solution...', 90);
          typeIntoEditor(data.code, data.find || '').then(() => {
            solveBtn.className = 'done';
            solveBtn.querySelector('.btn-text').textContent = 'OK';
            setStatus('Done! Solution applied.', 100);

            setTimeout(() => {
              solveBtn.className = '';
              solveBtn.querySelector('.btn-text').textContent = 'S';
              clearStatus();
              statusPanel.classList.remove('show');
            }, 3000);
          });
        }
      });

      socket.on('error', (data) => {
        console.error('[HR-Solver] Error:', data.message);
        if (!ninjaMode) {
          setStatus('Error: ' + data.message, 0);
          solveBtn.className = 'error';
          solveBtn.querySelector('.btn-text').textContent = 'X';
        }
        isSolving = false;

        setTimeout(() => {
          solveBtn.className = '';
          solveBtn.querySelector('.btn-text').textContent = 'S';
          clearStatus();
        }, 5000);
      });

    } catch (e) {
      console.error('[HR-Solver] Connection error:', e);
    }
  }

  // Get Problem Elements
  function getProblemElement() {
    return document.querySelector('.challenge_problem_statement')
      || document.querySelector('.problem-statement')
      || document.querySelector('.challenge-body-html')
      || document.querySelector('.challenge-body');
  }

  function getProblemHTML() {
    const el = getProblemElement();
    if (!el) return null;

    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, iframe, video, audio').forEach(e => e.remove());

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
pre, code { background: #f5f5f5; padding: 2px 6px; }
table { border-collapse: collapse; }
td, th { border: 1px solid #ddd; padding: 8px; }
</style>
</head>
<body>${clone.outerHTML}</body>
</html>`;
  }

  function getEditorCode() {
    // Monaco editor (challenge pages)
    try {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) return models[0].getValue();
      }
    } catch (e) {}

    // CodeMirror editor (contest pages)
    try {
      const cmEl = document.querySelector('.CodeMirror');
      if (cmEl && cmEl.CodeMirror) {
        return cmEl.CodeMirror.getValue();
      }
    } catch (e) {}

    // DOM fallback for Monaco
    try {
      const editors = document.querySelectorAll('.monaco-editor');
      if (editors.length > 0) {
        const lines = document.querySelectorAll('.view-lines .view-line');
        if (lines.length > 0) {
          return Array.from(lines).map(l => l.textContent).join('\n');
        }
      }
    } catch (e) {}

    return null;
  }

  function detectLanguage() {
    const langSelect = document.querySelector('[data-testid="language-selector"]')
      || document.querySelector('.select-language select')
      || document.querySelector('#select-lang');

    if (langSelect) {
      const val = langSelect.value || langSelect.textContent;
      return val.toLowerCase().trim();
    }

    const langEl = document.querySelector('.challenge-language');
    if (langEl) return langEl.textContent.trim().toLowerCase();

    const code = getEditorCode() || '';
    if (code.includes('def ') || code.includes('import sys')) return 'python';
    if (code.includes('public static void main')) return 'java';
    if (code.includes('#include')) return 'cpp';
    if (code.includes('require(') || code.includes('process.stdin')) return 'javascript';
    if (code.includes('func ')) return 'go';

    return 'javascript';
  }

  // Type into Monaco Editor
  async function typeIntoMonaco(solution, findText) {
    try {
      const model = window.monaco.editor.getModels()[0];
      const editor = window.monaco.editor.getEditors()[0];

      if (!model || !editor) {
        console.error('[HR-Solver] Could not access Monaco editor');
        fallbackPaste(solution);
        return;
      }

      let targetRange;

      if (findText) {
        const content = model.getValue();
        const idx = content.indexOf(findText);
        if (idx !== -1) {
          const startPos = model.getPositionAt(idx);
          const endPos = model.getPositionAt(idx + findText.length);
          targetRange = new window.monaco.Range(
            startPos.lineNumber, startPos.column,
            endPos.lineNumber, endPos.column
          );
        }
      }

      if (!targetRange) {
        const lineCount = model.getLineCount();
        const lastLineLength = model.getLineMaxColumn(lineCount);
        targetRange = new window.monaco.Range(1, 1, lineCount, lastLineLength);
      }

      editor.executeEdits('hr-solver', [{
        range: targetRange,
        text: '',
      }]);

      const startPos = targetRange.getStartPosition();
      editor.setPosition(startPos);
      editor.focus();

      const chars = solution.split('');

      for (let i = 0; i < chars.length; i++) {
        const pos = editor.getPosition();
        const range = new window.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);

        editor.executeEdits('hr-solver', [{
          range: range,
          text: chars[i],
        }]);

        if (chars[i] === '\n') {
          editor.setPosition({ lineNumber: pos.lineNumber + 1, column: 1 });
        } else {
          editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
        }

        editor.revealPositionInCenter(editor.getPosition());

        if (typingSpeed > 0) {
          const delay = chars[i] === ' ' || chars[i] === '\n' ? typingSpeed / 3 : typingSpeed;
          await sleep(delay);
        }

        const pct = Math.round((i / chars.length) * 100);
        if (pct % 5 === 0) {
          setStatus(`Typing... ${pct}%`, 90 + (pct / 10));
        }
      }

      console.log('[HR-Solver] Finished typing solution');

    } catch (e) {
      console.error('[HR-Solver] Monaco typing failed:', e);
      fallbackPaste(solution);
    }
  }

  // Type into CodeMirror Editor (contest pages)
  async function typeIntoCodeMirror(solution, findText) {
    try {
      const cmEl = document.querySelector('.CodeMirror');
      const cm = cmEl && cmEl.CodeMirror;

      if (!cm) {
        console.error('[HR-Solver] Could not access CodeMirror editor');
        fallbackPaste(solution);
        return;
      }

      if (findText) {
        const content = cm.getValue();
        const idx = content.indexOf(findText);
        if (idx !== -1) {
          const from = cm.posFromIndex(idx);
          const to = cm.posFromIndex(idx + findText.length);
          cm.replaceRange('', from, to);
          cm.setCursor(from);
        } else {
          cm.setValue('');
          cm.setCursor(0, 0);
        }
      } else {
        cm.setValue('');
        cm.setCursor(0, 0);
      }

      cm.focus();

      const chars = solution.split('');

      for (let i = 0; i < chars.length; i++) {
        const cursor = cm.getCursor();
        cm.replaceRange(chars[i], cursor);

        if (typingSpeed > 0) {
          const delay = chars[i] === ' ' || chars[i] === '\n' ? typingSpeed / 3 : typingSpeed;
          await sleep(delay);
        }

        const pct = Math.round((i / chars.length) * 100);
        if (pct % 5 === 0) {
          setStatus(`Typing... ${pct}%`, 90 + (pct / 10));
        }
      }

      console.log('[HR-Solver] Finished typing solution (CodeMirror)');

    } catch (e) {
      console.error('[HR-Solver] CodeMirror typing failed:', e);
      fallbackPaste(solution);
    }
  }

  // Dispatcher: pick the right editor to type into
  async function typeIntoEditor(solution, findText) {
    const cmEl = document.querySelector('.CodeMirror');
    if (cmEl && cmEl.CodeMirror) {
      return typeIntoCodeMirror(solution, findText);
    }
    return typeIntoMonaco(solution, findText);
  }

  function fallbackPaste(code) {
    try {
      navigator.clipboard.writeText(code).then(() => {
        setStatus('Copied to clipboard - paste with Ctrl+V', 100);
      });
    } catch (e) {
      prompt('Copy this solution:', code);
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Solve Handler
  function solve() {
    if (isSolving) return;
    if (!isConnected) {
      if (!ninjaMode) setStatus('Not connected to server. Is it running?', 0);
      console.log('[HR-Solver] Not connected to server');
      return;
    }

    const html = getProblemHTML();
    const code = getEditorCode();

    if (!html) {
      if (!ninjaMode) setStatus('Could not find problem statement on page', 0);
      console.log('[HR-Solver] Could not find problem statement');
      return;
    }

    if (!code) {
      if (!ninjaMode) setStatus('Could not read editor code', 0);
      console.log('[HR-Solver] Could not read editor code');
      return;
    }

    isSolving = true;
    if (!ninjaMode) {
      solveBtn.className = 'solving';
      solveBtn.querySelector('.btn-text').textContent = '...';
    }

    const language = detectLanguage();
    const url = window.location.href;
    const isContest = /\/contests\//.test(url);

    // Contest pages have better title in specific elements
    const titleEl = document.querySelector('h2.hr_tour-challenge-name')
      || document.querySelector('.challenge-view h2');
    const title = titleEl
      ? titleEl.textContent.trim()
      : document.title.replace(/\s*\|.*$/, '').trim();

    console.log(`[HR-Solver] Solving: ${title} (${language}) [${isContest ? 'contest' : 'challenge'}]`);
    if (!ninjaMode) setStatus('Sending to server...', 10);

    socket.emit('solve_problem', {
      html: html,
      code: code,
      language: language,
      title: title,
      url: url,
      ninja_mode: ninjaMode,
      is_contest: isContest,
    });
  }

  // Click Handler
  solveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    solve();
  });

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+N: Toggle ninja mode
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'N') {
      e.preventDefault();
      toggleNinjaMode();
      return;
    }

    // Ctrl+Shift+S: Solve/Scan
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'S') {
      e.preventDefault();
      solve();
      return;
    }

    // Any key: type next char (ninja mode, while held) - only when solution ready
    if (ninjaMode && ninjaSolution && !e.ctrlKey && !e.altKey && !e.metaKey
        && !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'Tab'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (!ninjaIsHoldingKey) {
        ninjaIsHoldingKey = true;
        ninjaTypeLoop();
      }
      return false;
    }
  }, true);  // Use capture phase to intercept before Monaco

  document.addEventListener('keyup', (e) => {
    // Release any key stops ninja typing
    if (ninjaMode && ninjaIsHoldingKey) {
      e.preventDefault();
      e.stopPropagation();
      ninjaIsHoldingKey = false;
    }
  }, true);

  // Also stop if window loses focus
  window.addEventListener('blur', () => {
    ninjaIsHoldingKey = false;
  });

  // Initialize
  console.log('[HR-Solver] Initializing...');
  console.log('[HR-Solver] Press Ctrl+Shift+N to enable NINJA MODE (hidden UI)');
  connectToServer();

  setInterval(() => {
    if (!isConnected && socket) {
      socket.connect();
    }
  }, 5000);

})();
