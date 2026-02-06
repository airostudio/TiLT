# TiLT Production Implementation Roadmap

## Overview

This document outlines the implementation plan to transform TiLT from a framework to a production-ready pinball emulator following industry best practices.

---

## Phase 1: Core Dependencies & Build System (Priority: CRITICAL)

### 1.1 External Libraries Integration

**Libraries to Integrate:**

1. **libarchive** - ZIP/RAR/7z extraction (replaces libzip)
   - Supports ZIP, RAR, 7z, tar, gzip, bzip2
   - Industry standard, battle-tested
   - Cross-platform (BSD license)

2. **GLFW** - Window/context management
   - Industry standard for OpenGL applications
   - Cross-platform window creation
   - Input handling (keyboard, mouse, gamepad)

3. **GLAD** - OpenGL loader
   - Generates OpenGL function loaders
   - Supports all OpenGL versions
   - Lightweight and fast

4. **OpenAL Soft** - 3D audio
   - Industry standard spatial audio
   - Cross-platform
   - Hardware-accelerated where available

5. **pugixml** - XML parsing
   - Fast, lightweight XML parser
   - Perfect for VPX and B2S files
   - Header-only option available

6. **ChaiScript** - Scripting engine
   - Header-only C++ scripting
   - Easy VBScript compatibility layer
   - No external dependencies

7. **stb_image** - Image loading
   - Header-only
   - Supports PNG, JPG, BMP, TGA, etc.
   - Industry standard

8. **GLM** - OpenGL Mathematics
   - Header-only
   - Vector/matrix operations
   - GLSL-compatible

**CMake Configuration:**
```cmake
find_package(LibArchive REQUIRED)
find_package(glfw3 REQUIRED)
find_package(OpenAL REQUIRED)
find_package(pugixml REQUIRED)
# Header-only libraries bundled in vendor/
```

---

## Phase 2: Archive Extraction (Priority: HIGH)

### 2.1 libarchive Integration

**Implementation:**
- Full ZIP extraction
- RAR extraction
- 7-Zip extraction
- Password-protected archives
- Multi-volume archives
- Progress callbacks
- Error handling

**Files to Modify:**
- `tools/import_manager.cpp`
- `tools/archive_extractor.hpp` (new)
- `tools/archive_extractor.cpp` (new)

**Features:**
- Stream extraction (memory efficient)
- Parallel extraction for large archives
- CRC verification
- Symbolic link handling
- Unicode filename support

---

## Phase 3: OpenGL Rendering (Priority: CRITICAL)

### 3.1 Window Management (GLFW)

**Implementation:**
- Window creation/destruction
- OpenGL context creation
- Input handling (keyboard, mouse, gamepad)
- Multiple monitor support
- Fullscreen toggle
- VSync control

### 3.2 OpenGL Rendering Pipeline

**Implementation:**
- Modern OpenGL 4.6 Core Profile
- Shader compilation and linking
- Vertex/Index buffer management
- Texture loading and management
- Frame buffer objects (FBO)
- Basic 3D rendering
- 2D overlay rendering

**Shader System:**
```glsl
// Vertex Shader (PBR-ready)
#version 460 core
layout (location = 0) in vec3 aPos;
layout (location = 1) in vec3 aNormal;
layout (location = 2) in vec2 aTexCoord;

// Fragment Shader (PBR lighting)
#version 460 core
out vec4 FragColor;
// PBR material properties
```

**Files to Implement:**
- `core/rendering/opengl/gl_context.cpp`
- `core/rendering/opengl/gl_shader.cpp`
- `core/rendering/opengl/gl_mesh.cpp`
- `core/rendering/opengl/gl_texture.cpp`
- `core/rendering/opengl/gl_framebuffer.cpp`

### 3.3 Rendering Features

- **Playfield Rendering:**
  - 3D table mesh
  - Ball rendering with shadows
  - Flipper animation
  - Bumper/slingshot effects
  - Ramp transparency
  - Light bloom effects

- **DMD Rendering:**
  - Dot matrix effect
  - Glow simulation
  - Color DMD support (Serum)
  - Scaling filters

- **Backglass Rendering:**
  - Multi-layer composition
  - Alpha blending
  - Video backgrounds
  - Lamp illumination

---

## Phase 4: Audio System (Priority: HIGH)

### 4.1 OpenAL Implementation

**Implementation:**
- Audio device initialization
- 3D spatial audio
- Multiple simultaneous sounds
- Sound pooling
- Music streaming
- Volume control (master, music, SFX)
- Audio effects (reverb, echo)

**Supported Formats:**
- WAV (direct loading)
- MP3 (via dr_mp3)
- OGG Vorbis (via stb_vorbis)
- FLAC (via dr_flac)

**Files to Implement:**
- `core/audio/openal_engine.cpp`
- `core/audio/audio_buffer.cpp`
- `core/audio/audio_source.cpp`
- `core/audio/audio_stream.cpp`
- `core/audio/audio_decoder.cpp`

**Features:**
- Sound caching
- 3D positioning (cabinet speaker simulation)
- Doppler effect
- Environmental effects
- Cross-fade
- Loop points

---

## Phase 5: Table File Parsing (Priority: CRITICAL)

### 5.1 VPX Table Parser

**Implementation:**
- OLE Compound Document parsing
- VPX binary format
- Table script extraction
- Material properties
- Physics properties
- Object hierarchy

**Data Structures:**
```cpp
struct VPXTable {
    std::string name;
    std::string author;
    std::vector<VPXObject> objects;
    std::string script;
    PhysicsProperties physics;
    std::vector<Material> materials;
    std::vector<Texture> textures;
};
```

**Files to Implement:**
- `core/loaders/vpx_loader.hpp`
- `core/loaders/vpx_loader.cpp`
- `core/loaders/vpx_objects.hpp`
- `core/loaders/ole_reader.cpp` (OLE parser)

### 5.2 Future Pinball Table Parser

**Implementation:**
- FPT XML parsing
- FP binary format
- BAM (Better Arcade Mode) support
- Script extraction

---

## Phase 6: ROM Emulation (Priority: MEDIUM)

### 6.1 CPU Emulation

**M6809 Emulator (Most Common):**
- Instruction decoding
- Register operations
- Memory management
- Interrupt handling
- Cycle-accurate timing
- Debug support

**Implementation Approach:**
- Based on existing MAME M6809 core
- Optimized for pinball use
- Real-time performance

**Files to Implement:**
- `core/emulation/cpu/m6809_core.cpp`
- `core/emulation/cpu/m6809_opcodes.cpp`
- `core/emulation/cpu/m6809_debug.cpp`

### 6.2 Board Emulation

**Williams WPC (Priority):**
- WPC-89 support
- WPC-S support
- WPC-95 support
- Memory mapping
- I/O handling
- DMD controller
- Sound board

**Files to Implement:**
- `core/emulation/boards/wpc/wpc_core.cpp`
- `core/emulation/boards/wpc/wpc_memory.cpp`
- `core/emulation/boards/wpc/wpc_dmd.cpp`
- `core/emulation/boards/wpc/wpc_sound.cpp`

---

## Phase 7: Scripting Engine (Priority: MEDIUM)

### 7.1 ChaiScript Integration

**Implementation:**
- ChaiScript engine initialization
- VBScript compatibility layer
- Function binding
- Event system
- Error handling
- Debugging support

**VBScript Compatibility:**
```cpp
// Map VBScript functions to ChaiScript
engine.add(fun(&PlaySound), "PlaySound");
engine.add(fun(&DOF), "DOF");
// etc.
```

**Files to Implement:**
- `core/scripting/chaiscript_engine.cpp`
- `core/scripting/vbscript_bindings.cpp`
- `core/scripting/script_api.hpp`

---

## Phase 8: B2S Backglass Parser (Priority: MEDIUM)

### 8.1 B2S XML Parser

**Implementation:**
- DirectB2S XML parsing
- Image layer loading
- Illumination mapping
- DMD positioning
- Animation support
- Multi-screen support

**Files to Implement:**
- `display/backglass/b2s_loader.cpp`
- `display/backglass/b2s_renderer.cpp`
- `display/backglass/b2s_animator.cpp`

---

## Phase 9: Network Features (Priority: LOW)

### 9.1 HTTP Client (libcurl)

**Implementation:**
- Media downloads
- Update checking
- Community server integration
- Progress tracking
- Resume support

**Files to Implement:**
- `core/network/http_client.cpp`
- `core/network/download_manager.cpp`
- `frontend/media_downloader.cpp`

---

## Technology Stack Summary

| Component | Library | License | Why |
|-----------|---------|---------|-----|
| Archive | libarchive | BSD | Industry standard, all formats |
| Window/Input | GLFW | zlib | Cross-platform, widely used |
| OpenGL Loader | GLAD | MIT | Lightweight, customizable |
| Audio | OpenAL Soft | LGPL | 3D audio, hardware acceleration |
| XML | pugixml | MIT | Fast, lightweight |
| Scripting | ChaiScript | BSD | Header-only, C++ native |
| Images | stb_image | Public Domain | Header-only, all formats |
| Math | GLM | MIT | Header-only, GLSL compatible |
| Audio Decode | dr_mp3, stb_vorbis | Public Domain | Header-only |
| Networking | libcurl | MIT-like | Industry standard |

---

## Implementation Order

### Sprint 1 (Week 1-2): Foundation
1. ✅ CMake external library detection
2. ✅ libarchive integration
3. ✅ Archive extraction implementation
4. ✅ Import system completion

### Sprint 2 (Week 3-4): Graphics
1. ✅ GLFW window management
2. ✅ GLAD OpenGL loader
3. ✅ Basic shader system
4. ✅ Simple 3D rendering
5. ✅ Texture loading

### Sprint 3 (Week 5-6): Audio
1. ✅ OpenAL initialization
2. ✅ WAV/MP3/OGG loading
3. ✅ 3D audio positioning
4. ✅ Sound manager

### Sprint 4 (Week 7-8): Table Loading
1. ✅ VPX OLE parser
2. ✅ VPX object loading
3. ✅ Material system
4. ✅ Basic table rendering

### Sprint 5 (Week 9-10): Physics
1. ✅ Collision detection
2. ✅ Ball physics refinement
3. ✅ Flipper interaction
4. ✅ Physics materials

### Sprint 6 (Week 11-12): Scripting
1. ✅ ChaiScript integration
2. ✅ VBScript compatibility
3. ✅ Event system
4. ✅ Table script loading

### Sprint 7 (Week 13-14): ROM Emulation
1. ✅ M6809 CPU core
2. ✅ WPC board basics
3. ✅ DMD emulation
4. ✅ Sound ROM playback

### Sprint 8 (Week 15-16): Polish
1. ✅ B2S backglass
2. ✅ DOF integration
3. ✅ Performance optimization
4. ✅ Bug fixing

---

## Best Practices to Follow

### Code Quality
- ✅ Modern C++20 features
- ✅ RAII everywhere
- ✅ Smart pointers only
- ✅ Const correctness
- ✅ Error handling with exceptions
- ✅ Logging system
- ✅ Unit tests (Google Test)
- ✅ Code reviews

### Performance
- ✅ Object pooling (balls, sounds, etc.)
- ✅ Texture atlases
- ✅ Instanced rendering
- ✅ Frustum culling
- ✅ Level of detail (LOD)
- ✅ Multi-threading (physics, audio, loading)
- ✅ Profile-guided optimization

### Architecture
- ✅ Dependency injection
- ✅ Interface segregation
- ✅ Single responsibility
- ✅ Open/closed principle
- ✅ Plugin architecture
- ✅ Event-driven design

### Documentation
- ✅ Doxygen comments
- ✅ Architecture diagrams
- ✅ API documentation
- ✅ User manual
- ✅ Developer guide

---

## Success Metrics

### Phase 1 Complete When:
- [ ] All libraries integrated
- [ ] CMake finds all dependencies
- [ ] Cross-platform build works

### Phase 2 Complete When:
- [ ] Can extract ZIP/RAR/7z
- [ ] Progress tracking works
- [ ] Error handling robust

### Phase 3 Complete When:
- [ ] Window opens with OpenGL context
- [ ] Can load and display textures
- [ ] Basic 3D rendering works
- [ ] 60+ FPS achieved

### Phase 4 Complete When:
- [ ] Sounds play correctly
- [ ] 3D positioning works
- [ ] Multiple sounds simultaneously
- [ ] No audio glitches

### Phase 5 Complete When:
- [ ] Can load VPX files
- [ ] Table geometry displayed
- [ ] Textures applied correctly
- [ ] Scripts extracted

### Phase 6 Complete When:
- [ ] M6809 passes test suite
- [ ] WPC board boots
- [ ] DMD displays correctly
- [ ] Sound board works

### Phase 7 Complete When:
- [ ] Scripts execute
- [ ] Events fire correctly
- [ ] VBScript functions work
- [ ] No crashes from scripts

### Production Ready When:
- [ ] All phases complete
- [ ] 100+ tables tested
- [ ] Performance targets met (60 FPS, <10ms input lag)
- [ ] Memory leaks fixed
- [ ] Crash-free for 1000+ hours
- [ ] User documentation complete

---

## Risk Mitigation

### High Risk Items:
1. **ROM Emulation Accuracy**
   - Mitigation: Use proven MAME cores
   - Fallback: Start with newer SAM boards (simpler)

2. **VPX File Format**
   - Mitigation: Study existing parsers (VPinMAME)
   - Fallback: Support FP first (simpler format)

3. **Performance**
   - Mitigation: Profile early and often
   - Fallback: Reduce visual quality settings

4. **Cross-Platform**
   - Mitigation: Test on all platforms weekly
   - Fallback: Focus on Linux/Windows first

---

**Status:** Ready to begin implementation
**Target:** Production-ready in 16 weeks
**Team:** 1-2 developers
**Budget:** Open source libraries (zero cost)
