# TiLT - Totally Integrated Luxurious Tables

**The Next-Generation Pinball Emulator**

TiLT is a unified pinball emulator that combines the best features from PinMAME, Visual Pinball X, B2S Server, and PinUP Popper into a single, modern, cross-platform application.

![TiLT Banner](docs/images/tilt-banner.png)

## Features

### ROM Emulation (PinMAME Features)
- ✅ Emulates 770+ unique pinball machines (2700+ ROM sets)
- ✅ Support for Williams/Bally WPC, System 11, Data East, Sega/Stern, Gottlieb
- ✅ Accurate DMD and LED display emulation
- ✅ Sound ROM emulation with authentic audio
- ✅ Binary output support for cabinet hardware
- ✅ Cross-platform: Windows, Linux, macOS, ARM devices

### Physics & Rendering (Visual Pinball X Features)
- ✅ Real-time 3D physics simulation
- ✅ Advanced ball physics with spin, friction, and momentum
- ✅ Multi-backend rendering: Vulkan, OpenGL, DirectX 12, Metal
- ✅ VR support with SteamVR integration
- ✅ Physically-based rendering (PBR) materials
- ✅ VBScript-compatible scripting engine
- ✅ Plugin system for extensibility

### Backglass System (B2S Features)
- ✅ Animated backglass with lighting effects
- ✅ DirectB2S format compatibility
- ✅ Multi-monitor support (playfield, backglass, DMD, topper)
- ✅ WYSIWYG backglass designer
- ✅ XML-based backglass definitions
- ✅ PWM support for realistic lamp fading
- ✅ Serum color DMD support

### Frontend & Launcher (PinUP Popper Features)
- ✅ Visual table browser with filtering and search
- ✅ Rating and favorites system
- ✅ PuP Packs - synchronized multimedia experiences
- ✅ One-click media downloads
- ✅ Statistics tracking (play count, play time, high scores)
- ✅ Multi-platform game support (VPX, FP, FX3)
- ✅ Web/mobile remote control API
- ✅ Customizable themes and layouts

### Installation System (Baller Installer Approach)
- ✅ One-click automated installation
- ✅ Dependency resolution and management
- ✅ Display configuration wizard
- ✅ Cabinet hardware detection
- ✅ Pre-configured optimal settings
- ✅ Automatic updates
- ✅ Modular component installation

### **NEW! Intelligent ZIP Import System**
- ✅ **Drag & Drop Interface** - Simply drag ZIP files to import
- ✅ **Smart File Classification** - Automatically detects file types
- ✅ **Intelligent Organization** - Places files in correct folders
- ✅ **Batch Import** - Import multiple ZIP files at once
- ✅ **Preview Before Import** - See what will be imported
- ✅ **Automatic Backups** - Safely backup existing files
- ✅ **Progress Tracking** - Real-time import progress
- ✅ **Command Line Tool** - `tilt-import` for automation

See [IMPORT_GUIDE.md](IMPORT_GUIDE.md) for detailed import instructions.

## Quick Start

### Installation

#### Windows
```bash
# Download the installer
curl -O https://tilt.example.com/download/tilt-installer-windows.exe

# Run the installer
./tilt-installer-windows.exe
```

#### Linux
```bash
# Download the installer
wget https://tilt.example.com/download/tilt-installer-linux.sh

# Make executable and run
chmod +x tilt-installer-linux.sh
./tilt-installer-linux.sh
```

#### macOS
```bash
# Download the installer
curl -O https://tilt.example.com/download/tilt-installer-macos.dmg

# Open the DMG and drag TiLT to Applications
open tilt-installer-macos.dmg
```

### Building from Source

#### Prerequisites
- CMake 3.20 or later
- C++20 compatible compiler (GCC 10+, Clang 12+, MSVC 2019+)
- Vulkan SDK (optional, for Vulkan renderer)
- OpenGL 4.6 (optional, for OpenGL renderer)

#### Build Instructions

```bash
# Clone the repository
git clone https://github.com/yourusername/TiLT.git
cd TiLT

# Create build directory
mkdir build && cd build

# Configure with CMake
cmake ..

# Build
cmake --build . --config Release

# Install (optional)
cmake --install .
```

#### Build Options
```bash
# Enable/disable specific features
cmake -DENABLE_VULKAN=ON \
      -DENABLE_OPENGL=ON \
      -DENABLE_VR=ON \
      -DBUILD_FRONTEND=ON \
      -DBUILD_INSTALLER=ON \
      ..
```

## Usage

### Importing Content (NEW!)

TiLT makes it incredibly easy to import tables, ROMs, and media with the intelligent ZIP import system:

#### Method 1: Drag & Drop (Easiest)
```bash
# Launch the import GUI
tilt-import -g

# Then drag your ZIP files into the window
```

#### Method 2: Command Line
```bash
# Import a single ZIP file
tilt-import MyTable.zip

# Import multiple files
tilt-import table1.zip table2.zip table3.zip

# Import all ZIPs from a directory
tilt-import -d ~/Downloads

# Preview before importing
tilt-import -p MyTable.zip
```

#### What Gets Imported?
- 📦 **Tables** (.vpx, .fp, .fpt) → Organized into `data/tables/`
- 🎮 **ROMs** (.zip) → Organized into `data/roms/`
- 🖼️ **Backglasses** (.directb2s, .b2s) → Organized into `data/backglasses/`
- 🎨 **Media** (images, videos, audio) → Organized into `data/media/`
- ⚡ **PuP Packs** (.pup) → Organized into `data/pup/`

**See the full [Import Guide](IMPORT_GUIDE.md) for detailed instructions.**

### Launching the Frontend
```bash
# Launch the table browser
tilt --frontend

# Or simply
tilt
```

### Playing a Specific Table
```bash
# Load a table with ROM
tilt --table medievalMadness.vpx --rom mm_109

# Load a table in VR mode
tilt --vr --table attackFromMars.vpx --rom afm_113
```

### Command Line Options
```
Usage: tilt [options] [table_file]

Options:
  -h, --help           Show this help message
  -v, --version        Show version information
  -f, --frontend       Launch frontend browser
  -t, --table <file>   Load and run specific table
  -r, --rom <name>     Specify ROM to emulate
  --vr                 Enable VR mode
  --renderer <name>    Specify renderer (dx12, vulkan, opengl, metal)
  --config <file>      Load configuration file

Examples:
  tilt -f                         # Launch frontend
  tilt -t table.vpx -r tz_94h     # Run specific table with ROM
  tilt --vr -t table.vpx          # Run in VR mode
```

## Configuration

TiLT uses a simple configuration file format:

```ini
# Display settings
display.width = 1920
display.height = 1080
display.fullscreen = false
display.vsync = true

# Renderer settings
renderer.type = vulkan
renderer.vr = false
renderer.msaa = 4

# Physics settings
physics.gravity = 9.81
physics.update_rate = 1000

# Audio settings
audio.master_volume = 1.0
audio.music_volume = 0.8
audio.sfx_volume = 1.0

# Paths
paths.tables = ./data/tables
paths.roms = ./data/roms
paths.media = ./data/media
paths.backglasses = ./data/backglasses
```

## Directory Structure

```
TiLT/
├── data/                  # Runtime data
│   ├── tables/            # Table files (.vpx, .fp)
│   ├── roms/              # ROM files
│   ├── media/             # Media assets
│   │   ├── artwork/       # Table artwork
│   │   ├── videos/        # Preview videos
│   │   ├── wheels/        # Wheel images
│   │   └── screenshots/   # Screenshots
│   ├── backglasses/       # Backglass files (.b2s)
│   └── config/            # Configuration files
├── core/                  # Core engine
├── display/               # Display systems
├── frontend/              # Frontend application
├── plugins/               # Plugins
└── installer/             # Installation system
```

## Supported Table Formats

- **VPX** - Visual Pinball X tables (full compatibility)
- **FP** - Future Pinball tables
- **TILT** - Native format with enhanced features

## Supported ROM Formats

- **PinMAME ROMs** - Full compatibility with existing ROM sets
- **Custom ROMs** - Support for homebrew ROMs

## Plugin Development

TiLT has an extensible plugin system. Create custom plugins to add new features:

```cpp
#include <tilt/plugin.hpp>

class MyPlugin : public tilt::Plugin {
public:
    void initialize() override {
        // Initialize your plugin
    }

    void shutdown() override {
        // Cleanup
    }

    std::string getName() const override {
        return "My Plugin";
    }
};

// Export plugin
TILT_EXPORT_PLUGIN(MyPlugin)
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `ctest`
5. Submit a pull request

## Architecture

For detailed information about TiLT's architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Performance Targets

- Physics Simulation: 1000 Hz update rate
- Rendering: 60+ FPS (120 FPS for VR)
- Input Latency: < 10ms
- ROM Emulation: Cycle-accurate timing
- Memory Usage: < 2GB for typical table
- Load Time: < 5 seconds for table initialization

## Roadmap

### Version 1.1
- [ ] Table editor with WYSIWYG designer
- [ ] Cloud sync for settings and high scores
- [ ] Online tournaments and leaderboards
- [ ] Mobile companion app

### Version 1.2
- [ ] AI-enhanced physics
- [ ] Replay system
- [ ] Achievement system
- [ ] Workshop for community content

### Version 2.0
- [ ] Native table creation tools
- [ ] Advanced scripting with Lua support
- [ ] Multiplayer support
- [ ] Streaming to mobile devices

## Community

- **Website**: https://tilt.example.com
- **Forum**: https://forum.tilt.example.com
- **Discord**: https://discord.gg/tilt
- **Reddit**: r/TiLTEmulator

## Credits

TiLT builds upon the excellent work of:
- **PinMAME** - Pinball ROM emulation
- **Visual Pinball** - Physics and rendering
- **B2S Server** - Backglass system
- **PinUP Popper** - Frontend inspiration
- **Baller Installer** - Installation methodology

Special thanks to the entire virtual pinball community for their dedication and passion.

## License

TiLT is released under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.

This project incorporates code from:
- PinMAME (BSD License)
- Visual Pinball (GPL v3)
- Various other open-source projects (see ACKNOWLEDGMENTS.md)

## Disclaimer

TiLT is a pinball emulator. ROM files are not included and must be obtained legally. TiLT is not affiliated with or endorsed by any pinball machine manufacturer.

---

**Made with ❤️ by the TiLT development team**
