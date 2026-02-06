# Vendor Libraries

This directory contains header-only libraries bundled with TiLT.

## Header-Only Libraries (include/)

Place header-only libraries in `vendor/include/`:

- **GLM** (OpenGL Mathematics) - MIT License
  - Download: https://github.com/g-truc/glm
  - Place in: `vendor/include/glm/`

- **stb_image** - Public Domain
  - Download: https://github.com/nothings/stb
  - Place in: `vendor/include/stb/stb_image.h`

- **stb_vorbis** - Public Domain
  - Download: https://github.com/nothings/stb
  - Place in: `vendor/include/stb/stb_vorbis.c`

- **dr_mp3** - Public Domain
  - Download: https://github.com/mackron/dr_libs
  - Place in: `vendor/include/dr_libs/dr_mp3.h`

- **dr_flac** - Public Domain
  - Download: https://github.com/mackron/dr_libs
  - Place in: `vendor/include/dr_libs/dr_flac.h`

- **GLAD** - MIT License (Generated)
  - Generate at: https://glad.dav1d.de/
  - OpenGL 4.6 Core Profile
  - Place in: `vendor/include/glad/`

- **ChaiScript** - BSD License
  - Download: https://github.com/ChaiScript/ChaiScript
  - Place in: `vendor/include/chaiscript/`

## System Libraries (Managed by Package Manager)

These libraries should be installed via your system package manager:

**Debian/Ubuntu:**
```bash
sudo apt install libarchive-dev libglfw3-dev libopenal-dev libpugixml-dev
```

**Fedora/RHEL:**
```bash
sudo dnf install libarchive-devel glfw-devel openal-soft-devel pugixml-devel
```

**macOS (Homebrew):**
```bash
brew install libarchive glfw openal-soft pugixml
```

**Windows (vcpkg):**
```powershell
vcpkg install libarchive:x64-windows glfw3:x64-windows openal-soft:x64-windows pugixml:x64-windows
```

## Optional: Vulkan SDK

Download from: https://vulkan.lunarg.com/

Required only if `ENABLE_VULKAN=ON`
