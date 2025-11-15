# TiLT Architecture
## Totally Integrated Luxurious Tables

TiLT is a unified pinball emulator that combines the best features from PinMAME, Visual Pinball X, B2S Server, PinUP Popper, and the installation methodology of Baller Installer.

## Design Philosophy

1. **Modularity**: Each subsystem is independent and can be updated/replaced without affecting others
2. **Cross-Platform**: Support Windows, Linux, macOS, and potentially mobile platforms
3. **Performance**: Optimized for low latency and high frame rates
4. **Extensibility**: Plugin architecture for community contributions
5. **User-Friendly**: One-click installation and intuitive interface

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TiLT Frontend Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Table Browser │  │Media Manager │  │  PuP Engine  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Rating System│  │  Web API     │  │Settings Panel│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Core Engine Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ROM Emulation │  │Physics Engine│  │Script Engine │      │
│  │  (PinMAME)   │  │    (VPX)     │  │  (VBScript)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Audio Engine  │  │   Lighting   │  │  I/O Handler │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Rendering Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Playfield   │  │  Backglass   │  │   DMD/LED    │      │
│  │  Renderer    │  │  Renderer    │  │   Display    │      │
│  │              │  │   (B2S)      │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌────────────────────────────────────────────────┐         │
│  │      Multi-Backend Support                      │         │
│  │  DirectX 12 | Vulkan | OpenGL | Metal          │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Platform Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Display    │  │    Input     │  │    Audio     │      │
│  │   Manager    │  │   Manager    │  │   Manager    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    File I/O  │  │   Network    │  │   Plugin API │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. ROM Emulation Engine (PinMAME Integration)

**Features:**
- Emulates 770+ unique pinball machine ROMs (2700+ variants)
- Hardware support: Williams/Bally WPC, System 11, Data East, Sega/Stern Whitestar, Stern SAM, Gottlieb, etc.
- Accurate timing and cycle emulation
- LED/DMD display emulation with high color depth
- Sound ROM emulation with original samples
- Binary output support for cabinet hardware (solenoids, flashers, motors)

**Technology:**
- Based on PinMAME/libPinMAME core
- C/C++ implementation for performance
- Modular board emulation for easy addition of new machines

### 2. Physics & Rendering Engine (VPX Evolution)

**Features:**
- Real-time 3D physics simulation
- Ball physics with spin, friction, and momentum
- Flipper, bumper, slingshot, and ramp simulation
- Gravity and slope calculations
- Multi-ball support
- Advanced lighting and shadows
- PBR (Physically Based Rendering) materials
- VR support with 6DOF tracking

**Technology:**
- Custom physics engine optimized for pinball mechanics
- Multi-threaded architecture for physics and rendering
- Support for both desktop and VR rendering modes
- Shader-based lighting system

**Rendering Backends:**
- **DirectX 12** (Windows) - Primary Windows backend
- **Vulkan** (Windows/Linux) - Cross-platform high performance
- **OpenGL 4.6** (Windows/Linux/macOS) - Compatibility mode
- **Metal** (macOS/iOS) - Apple platform optimization

### 3. Backglass System (B2S Enhanced)

**Features:**
- Animated backglass with lighting effects
- Score display emulation (LED, DMD, electromechanical)
- Multi-monitor support (portrait/landscape)
- WYSIWYG designer tool
- XML-based backglass definitions
- Image and video layer support
- Per-table and global configuration
- PWM support for realistic bulb fading
- Window punching for external DMD displays

**Technology:**
- Vector-based rendering for scaling
- Hardware-accelerated compositing
- Real-time animation engine
- Template system for rapid creation

### 4. Frontend & Launcher (PinUP Evolution)

**Features:**
- Visual table browser with filtering and search
- Category and playlist management
- Table rating and favorites system
- Media library (artwork, videos, screenshots, wheel art)
- PuP Packs - synchronized multimedia experiences
- One-click media downloads from community servers
- Statistics tracking (play count, play time, high scores)
- Multi-platform support (VPX, FP, FX3, Zaccaria, Pro Pinball)
- Web/mobile remote control API
- Customizable themes and layouts
- Attract mode with demo playback

**Technology:**
- Modern web-based UI (Electron/CEF) for cross-platform
- REST API for remote control
- WebSocket support for real-time updates
- Database backend (SQLite) for table metadata

### 5. Plugin System

**Features:**
- DOF (Direct Output Framework) integration
- Custom script support
- Table modification framework
- Serum color DMD support
- FlexDMD for custom displays
- Audio enhancement plugins
- Community extension marketplace

**Technology:**
- Language-agnostic plugin API
- Sandboxed execution environment
- Hot-reload support
- Version management

### 6. Installation System (Baller Evolution)

**Features:**
- One-click automated installation
- Dependency resolution and installation
- Display configuration wizard
- Cabinet hardware detection
- Pre-configured optimal settings
- Modular component installation
- Automatic updates
- Backup and restore functionality
- Configuration migration from existing setups

**Technology:**
- Package manager approach
- Manifest-based installation
- Rollback support
- Delta updates for bandwidth efficiency

## Data Flow

### Table Launch Sequence

```
User Selection → Frontend
                    ↓
            Load Table Data
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
   Initialize ROM          Load Table File
   (PinMAME Core)          (VPX Format)
        ↓                       ↓
   Start Emulation        Initialize Physics
        ↓                       ↓
        └───────────┬───────────┘
                    ↓
            Sync Game State
                    ↓
        ┌───────────┼───────────┐
        ↓           ↓           ↓
   Playfield    Backglass    DMD/LED
   Renderer     Renderer     Display
        ↓           ↓           ↓
        └───────────┴───────────┘
                    ↓
            Display Output
```

### Input Processing

```
Physical Input → Input Manager
                      ↓
              Map to Game Actions
                      ↓
         ┌────────────┼────────────┐
         ↓            ↓            ↓
    Cabinet I/O   Keyboard     Gamepad
         ↓            ↓            ↓
         └────────────┴────────────┘
                      ↓
              Game State Update
                      ↓
         ┌────────────┼────────────┐
         ↓                         ↓
    Physics Engine            ROM Emulator
         ↓                         ↓
    Update Objects            Update Outputs
         ↓                         ↓
         └────────────┬────────────┘
                      ↓
              Render Frame
```

## File Structure

```
tilt/
├── core/                      # Core engine
│   ├── emulation/             # ROM emulation (PinMAME)
│   │   ├── cpu/               # CPU emulators
│   │   ├── boards/            # Board-specific emulation
│   │   ├── sound/             # Sound emulation
│   │   └── display/           # Display emulation
│   ├── physics/               # Physics engine
│   │   ├── ball.cpp
│   │   ├── flipper.cpp
│   │   ├── collision.cpp
│   │   └── simulation.cpp
│   ├── rendering/             # Rendering engine
│   │   ├── dx12/              # DirectX 12
│   │   ├── vulkan/            # Vulkan
│   │   ├── opengl/            # OpenGL
│   │   ├── metal/             # Metal
│   │   └── common/            # Shared rendering code
│   ├── audio/                 # Audio engine
│   └── scripting/             # Script engine (VBScript compatible)
├── display/                   # Display systems
│   ├── playfield/             # Playfield renderer
│   ├── backglass/             # Backglass system (B2S)
│   │   ├── renderer/
│   │   ├── designer/          # WYSIWYG designer
│   │   └── templates/
│   └── dmd/                   # DMD/LED displays
├── frontend/                  # Frontend application
│   ├── ui/                    # User interface
│   │   ├── browser/           # Table browser
│   │   ├── media/             # Media viewer
│   │   └── settings/          # Settings panels
│   ├── api/                   # REST API
│   ├── database/              # Table database
│   └── pup/                   # PuP Pack engine
├── plugins/                   # Plugin system
│   ├── dof/                   # DOF integration
│   ├── flexdmd/               # FlexDMD support
│   ├── serum/                 # Serum color DMD
│   └── api/                   # Plugin API
├── installer/                 # Installation system
│   ├── wizard/                # Setup wizard
│   ├── packages/              # Package definitions
│   └── updater/               # Auto-updater
├── tools/                     # Development tools
│   ├── table-converter/       # Import VPX/FP tables
│   ├── rom-manager/           # ROM management
│   └── debugger/              # Debug tools
└── data/                      # Runtime data
    ├── tables/                # Table files
    ├── roms/                  # ROM files
    ├── media/                 # Media assets
    ├── backglasses/           # Backglass files
    └── config/                # Configuration
```

## Technology Stack

### Core Engine
- **Language**: C++20
- **Build System**: CMake
- **Physics**: Custom engine with Bullet Physics for collision detection
- **Scripting**: ChaiScript (VBScript compatible layer)
- **Threading**: C++20 threads, TBB for task parallelism

### Frontend
- **Framework**: Electron or Tauri (for cross-platform)
- **UI**: React + TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Redux Toolkit
- **API**: Express.js or Actix-web

### Database
- **Engine**: SQLite for local storage
- **ORM**: SQLAlchemy or Diesel
- **Caching**: Redis (optional)

### Graphics
- **DirectX**: DirectX 12 (Windows)
- **Vulkan**: Vulkan 1.3
- **OpenGL**: OpenGL 4.6 Core
- **Metal**: Metal 3 (macOS/iOS)
- **Shader Language**: HLSL/GLSL/MSL with SPIRV-Cross for cross-compilation

### Audio
- **Engine**: OpenAL Soft or miniaudio
- **Format Support**: WAV, MP3, OGG, FLAC
- **3D Audio**: OpenAL 3D positioning for cabinet speaker systems

### Networking
- **HTTP**: libcurl or reqwest
- **WebSocket**: libwebsockets or tokio-tungstenite
- **Protocol**: REST + WebSocket for real-time

## Performance Targets

- **Physics Simulation**: 1000 Hz update rate
- **Rendering**: 60+ FPS (120 FPS for VR)
- **Input Latency**: < 10ms
- **ROM Emulation**: Cycle-accurate timing
- **Memory Usage**: < 2GB for typical table
- **Load Time**: < 5 seconds for table initialization

## Compatibility

### Table Formats
- **VPX**: Full Visual Pinball X table support
- **FP**: Future Pinball table support
- **TILT**: Native format (enhanced features)

### ROM Formats
- **PinMAME**: Full compatibility with existing ROM sets
- **Custom**: Support for homebrew ROMs

### Backglass Formats
- **DirectB2S**: Full B2S backglass support
- **Video**: MP4/WebM animated backglasses
- **TILT**: Native format with enhanced features

## Extension Points

1. **Custom Physics**: Override physics calculations for specific elements
2. **Render Hooks**: Insert custom rendering before/after stages
3. **Script Extensions**: Add custom VBScript functions
4. **Event System**: Subscribe to game events
5. **Media Providers**: Add custom media sources
6. **Theme Engine**: Create custom frontend themes
7. **Output Devices**: Support custom cabinet hardware

## Security & Sandboxing

- Scripts run in sandboxed environment
- Plugin API with permission system
- Code signing for official plugins
- User consent for network access
- No arbitrary code execution from tables

## Future Enhancements

1. **Cloud Sync**: Save states and settings across devices
2. **Multiplayer**: Online tournaments and leaderboards
3. **Table Editor**: Integrated WYSIWYG table designer
4. **AI Training**: Machine learning for realistic ball physics
5. **Streaming**: Stream gameplay to mobile devices
6. **Workshop**: Community table and mod sharing
7. **Achievement System**: Unlockable goals and badges
8. **Replay System**: Record and share gameplay
