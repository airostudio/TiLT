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
    rendering/window.cpp
    rendering/vulkan/vulkan_renderer.cpp
    rendering/opengl/opengl_renderer.cpp
    rendering/opengl/gl_shader.cpp
    rendering/opengl/gl_texture.cpp
    rendering/opengl/gl_mesh.cpp
    audio/audio_engine.cpp
    audio/al_audio_engine.cpp
    audio/al_sound_buffer.cpp
    audio/al_sound_source.cpp
    audio/audio_decoder.cpp
    audio/mixer.cpp
    scripting/script_engine.cpp
    scripting/vbscript_compat.cpp
)

target_include_directories(tilt_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

# Link GLFW if available
if(TARGET glfw)
    target_link_libraries(tilt_core glfw)
elseif(WINDOW_LIBRARY)
    target_link_libraries(tilt_core ${WINDOW_LIBRARY})
endif()

# Link OpenGL
find_package(OpenGL)
if(OPENGL_FOUND)
    target_link_libraries(tilt_core OpenGL::GL)
endif()

# Link OpenAL if available
if(TARGET OpenAL::OpenAL)
    target_link_libraries(tilt_core OpenAL::OpenAL)
elseif(AUDIO_LIBRARY)
    target_link_libraries(tilt_core ${AUDIO_LIBRARY})
endif()
