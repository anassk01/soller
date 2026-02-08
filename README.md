# ⚡ HackerRank AI Solver

AI-powered tool that captures HackerRank problems, solves them with Google Gemini, and auto-types the solution into the editor — character by character.

> **Note:** This tool is for educational purposes only. Use responsibly and follow HackerRank's terms of service.

## Architecture

```
┌─────────────────────┐       WebSocket        ┌──────────────────────┐
│  Tampermonkey        │ ◄──────────────────►   │  Python Backend      │
│  Userscript          │                        │                      │
│  - Captures problem  │   POST problem HTML    │  - HTML → PNG        │
│  - Reads Monaco code │ ──────────────────►    │    (Playwright)      │
│  - Types solution    │                        │  - PNG + Code →      │
│    char by char      │   Streams solution     │    Gemini API        │
│                      │ ◄──────────────────    │  - Returns solution  │
└─────────────────────┘                        └──────────────────────┘
                                                        │
                                                        ▼
                                               ┌──────────────────────┐
                                               │  Dashboard (Web UI)  │
                                               │  http://localhost:5055│
                                               │  - Config / API key  │
                                               │  - Live activity     │
                                               │  - Problem preview   │
                                               │  - Solve history     │
                                               └──────────────────────┘
```

## Setup

### Prerequisites
- Python 3.10+
- Google Gemini API key ([get one free](https://aistudio.google.com/apikey))
- Tampermonkey browser extension

### 1. Install & Configure

```bash
# Clone/download the project, then:
chmod +x setup.sh start.sh
./setup.sh
```

This installs Python dependencies and Playwright's Chromium browser.

### 2. Start the Server

```bash
./start.sh
```

Open **http://localhost:5055** in your browser to access the dashboard.

### 3. Set Your API Key

In the dashboard, paste your Gemini API key and click **Save**. Click **Test API** to verify.

### 4. Install the Userscript

- Open Tampermonkey in your browser
- Click **Create a new script**
- Paste the contents of `userscript/hackerrank-solver.user.js`
- Save (Ctrl+S)

### 5. Solve Problems

1. Open any HackerRank problem page
2. You'll see a green ⚡ button in the bottom-right corner
3. Click it (or press **Ctrl+Shift+S**)
4. Watch the AI solution get typed into the editor!

## How It Works

1. **Capture**: The userscript grabs the problem's HTML (including SVG diagrams) and the current Monaco editor code
2. **Convert**: The backend renders the HTML into a PNG screenshot using Playwright's headless Chromium
3. **Solve**: The PNG image + starter code are sent to Google Gemini with a carefully crafted prompt
4. **Type**: The solution streams back and gets typed character-by-character into the Monaco editor

## Configuration

All config is managed through the dashboard at `http://localhost:5055`:

| Setting | Description | Default |
|---------|-------------|---------|
| **Gemini API Key** | Your Google AI API key | — |
| **Model** | Gemini model to use | `gemini-2.5-flash` |
| **Typing Speed** | Milliseconds per character (0 = instant) | 15 |

## File Structure

```
hackerrank-solver/
├── backend/
│   ├── server.py          # Flask + SocketIO backend
│   └── requirements.txt   # Python dependencies
├── frontend/
│   └── index.html         # Dashboard UI
├── userscript/
│   └── hackerrank-solver.user.js  # Tampermonkey script
├── setup.sh               # One-command setup
├── start.sh               # Start server
└── README.md
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+S** | Solve current problem |
| Click ⚡ button | Solve current problem |

## Supported Languages

The solver auto-detects the language from HackerRank's selector. Tested with:
- JavaScript / Node.js
- Python 3
- Java
- C++
- Go

## Troubleshooting

**"Not connected to server"**
- Make sure the backend is running (`./start.sh`)
- Check the browser console for WebSocket errors

**"Gemini API key not configured"**
- Open http://localhost:5055 and set your API key

**"Could not find problem statement"**
- Make sure you're on a `/problem` page (not `/submissions`)
- Wait for the page to fully load

**Solution doesn't type into editor**
- The script needs Monaco to be accessible via `window.monaco`
- If it fails, the solution is copied to clipboard instead

**Playwright installation fails**
- Run `python3 -m playwright install chromium` manually
- On Linux, you may need: `sudo npx playwright install-deps`

## Features

- **AI-Powered Solving**: Uses Google Gemini 2.5 for intelligent problem solving
- **Auto-Type Animation**: Types solution character-by-character into Monaco editor
- **Live Dashboard**: Real-time monitoring, problem previews, and solve history
- **Multi-Language Support**: JavaScript, Python, Java, C++, Go, and more
- **Ninja Mode**: Hidden UI mode for discreet operation (Ctrl+Shift+N)
- **Screenshot Capture**: Preserves problem statements with diagrams using Playwright
- **WebSocket Communication**: Real-time bidirectional updates between userscript and backend

## Security Notes

- **API Key Storage**: Your Gemini API key is stored in `backend/config.json` (excluded from git)
- Keep your API key private and never commit it to version control
- The `.gitignore` is configured to exclude sensitive files
- Recommended: Use environment variables for production deployments

## Notes

- The free Gemini API has rate limits; the `gemini-2.5-flash` model is recommended for speed
- Screenshots are saved in `backend/screenshots/` for debugging
- Solve history is stored in `backend/history.json` (last 100 entries)
- The typing effect can be disabled by setting speed to 0
- For educational and learning purposes only

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is open source and available for educational purposes.
