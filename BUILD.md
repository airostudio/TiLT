# Building TiLT

This document provides detailed instructions for building TiLT from source on various platforms.

## Dependencies

**IMPORTANT**: TiLT now requires external libraries for production features (archive extraction, rendering, audio, etc.).

👉 **See [BUILD_DEPENDENCIES.md](BUILD_DEPENDENCIES.md) for detailed dependency installation instructions.**

Quick summary of required libraries:
- **libarchive** - ZIP/RAR/7z extraction
- **GLFW** - Window management (for OpenGL renderer)
- **OpenAL** - 3D audio
- **pugixml** - XML parsing (VPX/B2S files)
- **Header-only libraries** - GLM, stb_image, GLAD, ChaiScript (bundled in vendor/)

You can build in two modes:
1. **Production Mode** (recommended) - With all dependencies, full functionality
2. **Framework Mode** - Without dependencies, framework-only (limited functionality)

## Prerequisites

### All Platforms

- **CMake** 3.20 or later
- **C++20 compatible compiler**:
  - GCC 10+ (Linux)
  - Clang 12+ (macOS/Linux)
  - MSVC 2019+ (Windows)
- **Git** for cloning the repository

### Windows

- Visual Studio 2019 or later (with C++ desktop development workload)
- OR MinGW-w64 with GCC 10+
- Vulkan SDK (optional, for Vulkan renderer)

### Linux

```bash
# Ubuntu/Debian
sudo apt install build-essential cmake git libvulkan-dev

# Fedora/RHEL
sudo dnf install gcc-c++ cmake git vulkan-devel

# Arch Linux
sudo pacman -S base-devel cmake git vulkan-icd-loader vulkan-headers
```

### macOS

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install cmake git
```

## Building

### Quick Build (All Platforms)

```bash
# Clone the repository
git clone https://github.com/yourusername/TiLT.git
cd TiLT

# Create build directory
mkdir build && cd build

# Configure
cmake ..

# Build
cmake --build . --config Release

# The executable will be in:
# - Linux/macOS: ./tilt
# - Windows: ./Release/tilt.exe
```

### Detailed Build Options

#### Configuration Options

```bash
cmake -DENABLE_VULKAN=ON \       # Enable Vulkan renderer (default: ON)
      -DENABLE_OPENGL=ON \       # Enable OpenGL renderer (default: ON)
      -DENABLE_DX12=ON \         # Enable DirectX 12 renderer (default: ON, Windows only)
      -DENABLE_VR=ON \           # Enable VR support (default: ON)
      -DBUILD_FRONTEND=ON \      # Build frontend (default: ON)
      -DBUILD_INSTALLER=ON \     # Build installer (default: ON)
      -DBUILD_TESTS=OFF \        # Build tests (default: OFF)
      -DCMAKE_BUILD_TYPE=Release \  # Build type: Release or Debug
      ..
```

#### Windows with Visual Studio

```powershell
# Generate Visual Studio solution
cmake -G "Visual Studio 16 2019" -A x64 ..

# Build from command line
cmake --build . --config Release

# Or open TiLT.sln in Visual Studio and build there
```

#### Windows with MinGW

```bash
cmake -G "MinGW Makefiles" ..
cmake --build . --config Release
```

#### Linux

```bash
# Default generator (Unix Makefiles)
cmake ..
make -j$(nproc)

# Or use Ninja for faster builds
cmake -G Ninja ..
ninja
```

#### macOS

```bash
# Default generator (Unix Makefiles)
cmake ..
make -j$(sysctl -n hw.ncpu)

# Or generate Xcode project
cmake -G Xcode ..
# Then open TiLT.xcodeproj in Xcode
```

## Installation

```bash
# Install to default location
# Linux: /usr/local
# macOS: /usr/local
# Windows: C:\Program Files\TiLT
sudo cmake --install .

# Install to custom location
cmake --install . --prefix /path/to/install
```

## Running

### After Building

```bash
# From build directory
./tilt --frontend

# Or with specific table
./tilt --table ../data/tables/example.vpx
```

### After Installation

```bash
# TiLT should be in your PATH
tilt --frontend
```

## Troubleshooting

### Vulkan SDK Not Found

If CMake cannot find the Vulkan SDK:

```bash
# Set environment variable
export VULKAN_SDK=/path/to/vulkan/sdk

# Then run cmake again
cmake ..
```

### Missing Dependencies

If you get errors about missing libraries:

#### Linux
```bash
# Check what libraries are missing
ldd ./tilt

# Install missing libraries
# Example for Ubuntu:
sudo apt install libvulkan1 libgl1
```

#### macOS
```bash
# Check dependencies
otool -L ./tilt

# Install missing dependencies with Homebrew
brew install <library-name>
```

### Compilation Errors

If you get C++20 related errors:

```bash
# Ensure your compiler supports C++20
# GCC 10+, Clang 12+, or MSVC 2019+

# Check compiler version
g++ --version
clang++ --version
cl /? # Windows
```

### CMake Version Too Old

```bash
# Ubuntu/Debian
sudo apt install cmake

# Or install from source
wget https://cmake.org/files/v3.28/cmake-3.28.0.tar.gz
tar xf cmake-3.28.0.tar.gz
cd cmake-3.28.0
./bootstrap && make && sudo make install
```

## Development Build

For development, use a Debug build with tests:

```bash
mkdir build-debug && cd build-debug
cmake -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTS=ON ..
cmake --build .

# Run tests
ctest --output-on-failure
```

## Cross-Compilation

### For Raspberry Pi (from x86 Linux)

```bash
# Install cross-compilation toolchain
sudo apt install gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf

# Create toolchain file (arm-linux-gnueabihf.cmake):
cat > arm-linux-gnueabihf.cmake << EOF
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER arm-linux-gnueabihf-gcc)
set(CMAKE_CXX_COMPILER arm-linux-gnueabihf-g++)
EOF

# Configure with toolchain
cmake -DCMAKE_TOOLCHAIN_FILE=arm-linux-gnueabihf.cmake ..

# Build
make
```

## Performance Optimization

### Release Build with Optimizations

```bash
cmake -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_CXX_FLAGS="-O3 -march=native" \
      ..
```

### Link-Time Optimization (LTO)

```bash
cmake -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON \
      ..
```

## Package Creation

### Linux (DEB package)

```bash
cmake -DCMAKE_BUILD_TYPE=Release ..
make
cpack -G DEB
```

### Linux (RPM package)

```bash
cmake -DCMAKE_BUILD_TYPE=Release ..
make
cpack -G RPM
```

### Windows (MSI installer)

```bash
cmake -G "Visual Studio 16 2019" ..
cmake --build . --config Release
cpack -G WIX
```

### macOS (DMG)

```bash
cmake -G Xcode ..
cmake --build . --config Release
cpack -G DragNDrop
```

## Need Help?

- Check [GitHub Issues](https://github.com/yourusername/TiLT/issues)
- Join our [Discord](https://discord.gg/tilt)
- Visit the [Forum](https://forum.tilt.example.com)
