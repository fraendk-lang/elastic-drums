#!/bin/bash
# Build C++ core to WebAssembly via Emscripten
# Requires: emsdk installed and activated

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/core/build-wasm"
OUTPUT_DIR="$PROJECT_DIR/public/wasm"

echo "=== Elastic Drums WASM Build ==="

# Check for emscripten
if ! command -v emcmake &> /dev/null; then
    echo "Error: Emscripten not found. Install emsdk:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

# Build
mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"
cd "$BUILD_DIR"

emcmake cmake "$PROJECT_DIR/core" -DCMAKE_BUILD_TYPE=Release
emmake make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)

# Copy output
cp "$BUILD_DIR/wasm/elastic-drums-wasm.js" "$OUTPUT_DIR/"
cp "$BUILD_DIR/wasm/elastic-drums-wasm.wasm" "$OUTPUT_DIR/"

echo "=== WASM build complete: $OUTPUT_DIR ==="
