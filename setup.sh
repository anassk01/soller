#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       ⚡ HackerRank Solver — Setup Script           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "❌ Python 3 is required. Install it first."
    exit 1
fi
echo "✅ Python 3 found: $(python3 --version)"

# Create virtual environment
echo ""
echo "📦 Creating virtual environment..."
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
echo "📦 Installing Python dependencies..."
pip install --upgrade pip
pip install -r backend/requirements.txt

# Install Playwright browsers
echo ""
echo "🌐 Installing Playwright browser (Chromium)..."
python3 -m playwright install chromium
python3 -m playwright install-deps chromium 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ Setup complete!                                  ║"
echo "║                                                      ║"
echo "║  Next steps:                                         ║"
echo "║                                                      ║"
echo "║  1. Start the server:                                ║"
echo "║     ./start.sh                                       ║"
echo "║                                                      ║"
echo "║  2. Open http://localhost:5055 to set your           ║"
echo "║     Gemini API key                                   ║"
echo "║                                                      ║"
echo "║  3. Install the userscript in Tampermonkey:          ║"
echo "║     userscript/hackerrank-solver.user.js             ║"
echo "║                                                      ║"
echo "║  4. Open a HackerRank problem and click ⚡           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
