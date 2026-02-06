# TiLT Vendor Libraries Setup Script (Windows PowerShell)
# Automatically downloads and installs header-only libraries

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$VendorDir = Join-Path $ProjectRoot "vendor\include"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "TiLT Vendor Libraries Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Installing header-only libraries to: $VendorDir"
Write-Host ""

# Create vendor directory
New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null
Set-Location $VendorDir

# GLM - OpenGL Mathematics
Write-Host "[1/5] Installing GLM..." -ForegroundColor Yellow
if (Test-Path "glm") {
    Write-Host "  - GLM already installed, skipping" -ForegroundColor Gray
} else {
    git clone --depth 1 https://github.com/g-truc/glm.git
    Write-Host "  - GLM installed successfully" -ForegroundColor Green
}

# stb Libraries
Write-Host "[2/5] Installing stb libraries..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "stb" | Out-Null
Set-Location "stb"

if (Test-Path "stb_image.h") {
    Write-Host "  - stb_image.h already exists, skipping" -ForegroundColor Gray
} else {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nothings/stb/master/stb_image.h" -OutFile "stb_image.h"
    Write-Host "  - stb_image.h downloaded" -ForegroundColor Green
}

if (Test-Path "stb_vorbis.c") {
    Write-Host "  - stb_vorbis.c already exists, skipping" -ForegroundColor Gray
} else {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nothings/stb/master/stb_vorbis.c" -OutFile "stb_vorbis.c"
    Write-Host "  - stb_vorbis.c downloaded" -ForegroundColor Green
}

Set-Location $VendorDir

# dr_libs - Audio Decoders
Write-Host "[3/5] Installing dr_libs..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "dr_libs" | Out-Null
Set-Location "dr_libs"

if (Test-Path "dr_mp3.h") {
    Write-Host "  - dr_mp3.h already exists, skipping" -ForegroundColor Gray
} else {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mackron/dr_libs/master/dr_mp3.h" -OutFile "dr_mp3.h"
    Write-Host "  - dr_mp3.h downloaded" -ForegroundColor Green
}

if (Test-Path "dr_flac.h") {
    Write-Host "  - dr_flac.h already exists, skipping" -ForegroundColor Gray
} else {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mackron/dr_libs/master/dr_flac.h" -OutFile "dr_flac.h"
    Write-Host "  - dr_flac.h downloaded" -ForegroundColor Green
}

Set-Location $VendorDir

# GLAD - OpenGL Loader
Write-Host "[4/5] Installing GLAD..." -ForegroundColor Yellow
if (Test-Path "glad") {
    Write-Host "  - GLAD already installed, skipping" -ForegroundColor Gray
} else {
    Write-Host "  - Please visit https://glad.dav1d.de/ to generate GLAD files" -ForegroundColor Yellow
    Write-Host "  - Select: OpenGL 4.6, Core Profile" -ForegroundColor Yellow
    Write-Host "  - Extract to: $VendorDir\glad" -ForegroundColor Yellow
    Write-Host "  - Skipping automatic GLAD installation (requires Python)" -ForegroundColor Gray
}

# ChaiScript - Scripting Engine
Write-Host "[5/5] Installing ChaiScript..." -ForegroundColor Yellow
if (Test-Path "chaiscript") {
    Write-Host "  - ChaiScript already installed, skipping" -ForegroundColor Gray
} else {
    git clone --depth 1 https://github.com/ChaiScript/ChaiScript.git chaiscript
    Write-Host "  - ChaiScript installed successfully" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Vendor libraries setup complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Installed libraries:" -ForegroundColor White
Write-Host "  ✓ GLM (OpenGL Mathematics)" -ForegroundColor Green
Write-Host "  ✓ stb_image (Image loading)" -ForegroundColor Green
Write-Host "  ✓ stb_vorbis (OGG audio)" -ForegroundColor Green
Write-Host "  ✓ dr_mp3 (MP3 audio)" -ForegroundColor Green
Write-Host "  ✓ dr_flac (FLAC audio)" -ForegroundColor Green
Write-Host "  ! GLAD (OpenGL loader) - Manual setup required" -ForegroundColor Yellow
Write-Host "  ✓ ChaiScript (Scripting engine)" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Install system libraries via vcpkg (see BUILD_DEPENDENCIES.md)" -ForegroundColor Gray
Write-Host "  2. Configure build: cmake -B build" -ForegroundColor Gray
Write-Host "  3. Build: cmake --build build" -ForegroundColor Gray
Write-Host ""
