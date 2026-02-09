#!/bin/bash
cd "$(dirname "$0")"

if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

echo "⚡ Starting Soller..."
python3 backend/server.py
