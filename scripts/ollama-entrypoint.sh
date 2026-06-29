#!/bin/sh
# Start Ollama, then pull the model if not already cached in the volume.
MODEL="${OLLAMA_MODEL:-qwen3:4b}"

ollama serve &
SERVE_PID=$!

# Wait for server to accept connections
echo "[ollama] Starting server..."
i=0
until curl -sf http://localhost:11434/ > /dev/null 2>&1; do
    i=$((i+1))
    if [ $i -gt 30 ]; then echo "[ollama] Server did not start in 60s"; break; fi
    sleep 2
done

# Pull the model only if not already present (the volume caches it)
if ollama list 2>/dev/null | grep -qF "$MODEL"; then
    echo "[ollama] Model $MODEL already cached — ready."
else
    echo "[ollama] Pulling $MODEL (first run — may take several minutes on slow connections)..."
    ollama pull "$MODEL" && echo "[ollama] Model ready." || echo "[ollama] Pull failed — will retry next start."
fi

wait $SERVE_PID
