#!/bin/bash
# TiLT Vendor Libraries Setup Script
# Automatically downloads and installs header-only libraries

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$PROJECT_ROOT/vendor/include"

echo "============================================"
echo "TiLT Vendor Libraries Setup"
echo "============================================"
echo ""
echo "Installing header-only libraries to: $VENDOR_DIR"
echo ""

# Create vendor directory
mkdir -p "$VENDOR_DIR"
cd "$VENDOR_DIR"

# GLM - OpenGL Mathematics
echo "[1/5] Installing GLM..."
if [ -d "glm" ]; then
    echo "  - GLM already installed, skipping"
else
    git clone --depth 1 https://github.com/g-truc/glm.git
    echo "  - GLM installed successfully"
fi

# stb Libraries
echo "[2/5] Installing stb libraries..."
mkdir -p stb
cd stb
if [ -f "stb_image.h" ]; then
    echo "  - stb_image.h already exists, skipping"
else
    wget -q https://raw.githubusercontent.com/nothings/stb/master/stb_image.h
    echo "  - stb_image.h downloaded"
fi
if [ -f "stb_vorbis.c" ]; then
    echo "  - stb_vorbis.c already exists, skipping"
else
    wget -q https://raw.githubusercontent.com/nothings/stb/master/stb_vorbis.c
    echo "  - stb_vorbis.c downloaded"
fi
cd "$VENDOR_DIR"

# dr_libs - Audio Decoders
echo "[3/5] Installing dr_libs..."
mkdir -p dr_libs
cd dr_libs
if [ -f "dr_mp3.h" ]; then
    echo "  - dr_mp3.h already exists, skipping"
else
    wget -q https://raw.githubusercontent.com/mackron/dr_libs/master/dr_mp3.h
    echo "  - dr_mp3.h downloaded"
fi
if [ -f "dr_flac.h" ]; then
    echo "  - dr_flac.h already exists, skipping"
else
    wget -q https://raw.githubusercontent.com/mackron/dr_libs/master/dr_flac.h
    echo "  - dr_flac.h downloaded"
fi
cd "$VENDOR_DIR"

# GLAD - OpenGL Loader
echo "[4/5] Installing GLAD..."
if [ -d "glad" ]; then
    echo "  - GLAD already installed, skipping"
else
    echo "  - Downloading pre-generated GLAD files..."
    # Clone a pre-generated GLAD repository
    git clone --depth 1 https://github.com/Dav1dde/glad.git glad_temp
    cd glad_temp

    # Generate GLAD for OpenGL 4.6 Core
    python -m glad --api gl:core=4.6 --out-path ../glad

    cd ..
    rm -rf glad_temp
    echo "  - GLAD installed successfully"
fi

# ChaiScript - Scripting Engine
echo "[5/5] Installing ChaiScript..."
if [ -d "chaiscript" ]; then
    echo "  - ChaiScript already installed, skipping"
else
    git clone --depth 1 https://github.com/ChaiScript/ChaiScript.git chaiscript
    echo "  - ChaiScript installed successfully"
fi

echo ""
echo "============================================"
echo "Vendor libraries setup complete!"
echo "============================================"
echo ""
echo "Installed libraries:"
echo "  ✓ GLM (OpenGL Mathematics)"
echo "  ✓ stb_image (Image loading)"
echo "  ✓ stb_vorbis (OGG audio)"
echo "  ✓ dr_mp3 (MP3 audio)"
echo "  ✓ dr_flac (FLAC audio)"
echo "  ✓ GLAD (OpenGL loader)"
echo "  ✓ ChaiScript (Scripting engine)"
echo ""
echo "Next steps:"
echo "  1. Install system libraries (see BUILD_DEPENDENCIES.md)"
echo "  2. Configure build: cmake -B build"
echo "  3. Build: cmake --build build"
echo ""
