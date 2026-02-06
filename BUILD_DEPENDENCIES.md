# TiLT Build Dependencies

This document explains how to install the required libraries to build TiLT with full production features.

## Overview

TiLT uses a hybrid approach for dependencies:
- **System Libraries**: Complex libraries installed via package manager (libarchive, GLFW, OpenAL, pugixml)
- **Header-Only Libraries**: Bundled in `vendor/include/` (GLM, stb_image, GLAD, ChaiScript)

## Platform-Specific Installation

### Linux (Debian/Ubuntu)

```bash
# Update package list
sudo apt update

# Install required libraries
sudo apt install -y \
    build-essential \
    cmake \
    git \
    libarchive-dev \
    libglfw3-dev \
    libopenal-dev \
    libpugixml-dev

# Optional: Vulkan SDK for Vulkan renderer
wget -qO - https://packages.lunarg.com/lunarg-signing-key-pub.asc | sudo apt-key add -
sudo wget -qO /etc/apt/sources.list.d/lunarg-vulkan-jammy.list https://packages.lunarg.com/vulkan/lunarg-vulkan-jammy.list
sudo apt update
sudo apt install -y vulkan-sdk
```

### Linux (Fedora/RHEL/CentOS)

```bash
# Install required libraries
sudo dnf install -y \
    gcc-c++ \
    cmake \
    git \
    libarchive-devel \
    glfw-devel \
    openal-soft-devel \
    pugixml-devel

# Optional: Vulkan SDK
sudo dnf install -y vulkan-loader-devel vulkan-headers
```

### Linux (Arch Linux)

```bash
# Install required libraries
sudo pacman -S --needed \
    base-devel \
    cmake \
    git \
    libarchive \
    glfw \
    openal \
    pugixml

# Optional: Vulkan SDK
sudo pacman -S vulkan-devel
```

### macOS (Homebrew)

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required libraries
brew install \
    cmake \
    libarchive \
    glfw \
    openal-soft \
    pugixml

# Optional: Vulkan SDK (install from LunarG website)
# Download from: https://vulkan.lunarg.com/sdk/home#mac
```

### Windows (vcpkg)

```powershell
# Install vcpkg (if not already installed)
git clone https://github.com/Microsoft/vcpkg.git
cd vcpkg
.\bootstrap-vcpkg.bat

# Install required libraries
.\vcpkg install libarchive:x64-windows
.\vcpkg install glfw3:x64-windows
.\vcpkg install openal-soft:x64-windows
.\vcpkg install pugixml:x64-windows

# Optional: Vulkan SDK
# Download and install from: https://vulkan.lunarg.com/sdk/home#windows

# Integrate vcpkg with CMake
.\vcpkg integrate install
```

### Windows (MSYS2)

```bash
# Update package database
pacman -Syu

# Install required libraries
pacman -S --needed \
    mingw-w64-x86_64-gcc \
    mingw-w64-x86_64-cmake \
    mingw-w64-x86_64-libarchive \
    mingw-w64-x86_64-glfw \
    mingw-w64-x86_64-openal \
    mingw-w64-x86_64-pugixml
```

## Header-Only Libraries Setup

These libraries should be placed in `vendor/include/`. You can either download them manually or use the provided setup script.

### Manual Installation

1. **GLM (OpenGL Mathematics)**
   ```bash
   cd vendor/include
   git clone https://github.com/g-truc/glm.git
   ```

2. **stb Libraries**
   ```bash
   cd vendor/include
   mkdir -p stb
   cd stb
   wget https://raw.githubusercontent.com/nothings/stb/master/stb_image.h
   wget https://raw.githubusercontent.com/nothings/stb/master/stb_vorbis.c
   ```

3. **dr_libs (Audio Decoders)**
   ```bash
   cd vendor/include
   mkdir -p dr_libs
   cd dr_libs
   wget https://raw.githubusercontent.com/mackron/dr_libs/master/dr_mp3.h
   wget https://raw.githubusercontent.com/mackron/dr_libs/master/dr_flac.h
   ```

4. **GLAD (OpenGL Loader)**
   - Visit https://glad.dav1d.de/
   - Select: OpenGL 4.6, Core Profile
   - Generate and download
   - Extract to `vendor/include/glad/`

5. **ChaiScript**
   ```bash
   cd vendor/include
   git clone https://github.com/ChaiScript/ChaiScript.git chaiscript
   ```

### Automated Setup Script

```bash
# Linux/macOS
./scripts/setup_vendor_libs.sh

# Windows (PowerShell)
.\scripts\setup_vendor_libs.ps1
```

## Library Versions

| Library | Minimum Version | Tested Version | License |
|---------|----------------|----------------|---------|
| CMake | 3.20 | 3.28.3 | BSD |
| libarchive | 3.4.0 | 3.6.2 | BSD |
| GLFW | 3.3 | 3.3.8 | zlib |
| OpenAL Soft | 1.19 | 1.23.1 | LGPL |
| pugixml | 1.11 | 1.13 | MIT |
| Vulkan SDK | 1.2 | 1.3.x | Apache 2.0 |
| GLM | 0.9.9 | 1.0.1 | MIT |
| stb_image | N/A | Latest | Public Domain |
| ChaiScript | 6.1 | 6.1.0 | BSD |

## Build Options

Control which features to enable:

```bash
cmake -B build \
  -DBUILD_FRONTEND=ON \
  -DBUILD_INSTALLER=ON \
  -DENABLE_VULKAN=ON \
  -DENABLE_OPENGL=ON \
  -DENABLE_VR=ON \
  -DUSE_SYSTEM_LIBS=ON
```

### CMake Options

- `BUILD_FRONTEND` (ON/OFF) - Build the frontend/launcher application
- `BUILD_INSTALLER` (ON/OFF) - Build the installation system
- `ENABLE_VULKAN` (ON/OFF) - Enable Vulkan renderer
- `ENABLE_OPENGL` (ON/OFF) - Enable OpenGL renderer
- `ENABLE_DX12` (ON/OFF) - Enable DirectX 12 renderer (Windows only)
- `ENABLE_VR` (ON/OFF) - Enable VR support
- `BUILD_TESTS` (ON/OFF) - Build unit tests
- `USE_SYSTEM_LIBS` (ON/OFF) - Use system libraries vs bundled vendor libs

## Troubleshooting

### Library Not Found

If CMake cannot find a library:

```bash
# Find where the library is installed
# Linux
dpkg -L libarchive-dev

# macOS
brew list libarchive

# Manually specify library path
cmake -B build -DLibArchive_ROOT=/path/to/libarchive
```

### Vulkan SDK Not Found

```bash
# Set Vulkan SDK path manually
export VULKAN_SDK=/path/to/vulkan/sdk
cmake -B build
```

### vcpkg Integration Issues (Windows)

```bash
# Make sure vcpkg is integrated
.\vcpkg integrate install

# Then configure with toolchain file
cmake -B build -DCMAKE_TOOLCHAIN_FILE=[path-to-vcpkg]/scripts/buildsystems/vcpkg.cmake
```

### Missing Header-Only Libraries

If header-only libraries are missing, they won't cause CMake errors but will fail during compilation. Make sure all headers are in `vendor/include/`.

## Minimal Build (No External Dependencies)

To build TiLT with only standard libraries (framework mode, limited functionality):

```bash
cmake -B build \
  -DUSE_SYSTEM_LIBS=OFF \
  -DENABLE_VULKAN=OFF \
  -DENABLE_OPENGL=OFF \
  -DBUILD_FRONTEND=OFF

cmake --build build
```

This will build the core framework but without:
- Archive extraction (ZIP/RAR/7z)
- Graphics rendering
- Audio output
- XML parsing

## Verification

After installing dependencies, verify they can be found:

```bash
# Configure build
cmake -B build

# Check CMake output for "Found" messages:
# -- Found LibArchive: ...
# -- Found GLFW3: ...
# -- Found OpenAL: ...
# -- Found pugixml: ...
# -- Found Vulkan: ... (optional)
```

## Next Steps

After installing dependencies:

1. Build the project: `cmake --build build`
2. Run tests (if enabled): `ctest --test-dir build`
3. Install: `cmake --install build`

See [BUILD.md](BUILD.md) for detailed build instructions.
