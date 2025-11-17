add_library(tilt_core STATIC
    engine.cpp
    config.cpp
    emulation/rom_emulator.cpp
    emulation/cpu/z80.cpp
    emulation/cpu/m6800.cpp
    emulation/cpu/m6809.cpp
    emulation/boards/wpc.cpp
    emulation/boards/dataeast.cpp
    emulation/boards/whitestar.cpp
    emulation/sound/sound_emulator.cpp
    emulation/display/dmd_emulator.cpp
    physics/ball.cpp
    physics/flipper.cpp
    physics/collision.cpp
    physics/simulation.cpp
    physics/world.cpp
    rendering/renderer.cpp
    rendering/shader_manager.cpp
    rendering/vulkan/vulkan_renderer.cpp
    rendering/opengl/opengl_renderer.cpp
    audio/audio_engine.cpp
    audio/mixer.cpp
    scripting/script_engine.cpp
    scripting/vbscript_compat.cpp
)

target_include_directories(tilt_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

# Link libraries (these would be found via find_package in real implementation)
# target_link_libraries(tilt_core vulkan opengl openal)
