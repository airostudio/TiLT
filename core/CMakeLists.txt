set(TILT_CORE_SOURCES
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
    scripting/script_engine.cpp
    scripting/vbscript_compat.cpp
)

# ── Emscripten / WASM build ────────────────────────────────────────────────
if(EMSCRIPTEN)
    # WebGL renderer replaces native OpenGL / Vulkan / window code.
    # Emscripten supplies GLFW, WebGL2 (GLES3), and OpenAL via linker flags
    # (-sUSE_WEBGL2=1 -sUSE_GLFW=3 -sUSE_OPENAL=1); no find_package needed.
    list(APPEND TILT_CORE_SOURCES
        rendering/webgl/webgl_renderer.cpp
    )
    # Audio sources still compile — they call the OpenAL API which Emscripten
    # provides at link time through -sUSE_OPENAL=1.
    list(APPEND TILT_CORE_SOURCES
        audio/al_audio_engine.cpp
        audio/al_sound_buffer.cpp
        audio/al_sound_source.cpp
        audio/audio_decoder.cpp
        audio/mixer.cpp
    )
    # window.cpp uses native GLFW APIs that differ from the Emscripten GLFW
    # shim; include it so it compiles but guard the body with #ifndef __EMSCRIPTEN__
    # in the source.  For now exclude it — the main loop is driven by
    # emscripten_set_main_loop() instead.
    message(STATUS "[TiLT] Emscripten build: using WebGL2 renderer, skipping native GLAD/GLFW/window/Vulkan")
else()
    # ── Native desktop build ────────────────────────────────────────────────
    list(APPEND TILT_CORE_SOURCES
        rendering/window.cpp
        rendering/vulkan/vulkan_renderer.cpp
        audio/al_audio_engine.cpp
        audio/al_sound_buffer.cpp
        audio/al_sound_source.cpp
        audio/audio_decoder.cpp
        audio/mixer.cpp
    )

    if(ENABLE_OPENGL)
        list(APPEND TILT_CORE_SOURCES
            rendering/opengl/opengl_renderer.cpp
            rendering/opengl/gl_shader.cpp
            rendering/opengl/gl_texture.cpp
            rendering/opengl/gl_mesh.cpp
        )
        # glad.c is the OpenGL function loader; compile it as part of the core lib
        set(GLAD_C ${CMAKE_SOURCE_DIR}/vendor/glad.c)
        if(EXISTS ${GLAD_C})
            list(APPEND TILT_CORE_SOURCES ${GLAD_C})
        endif()
    endif()
endif()

add_library(tilt_core STATIC ${TILT_CORE_SOURCES})

target_include_directories(tilt_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

# ── Linking ────────────────────────────────────────────────────────────────
if(EMSCRIPTEN)
    # All library linkage for Emscripten is handled via target_link_options on
    # the top-level 'tilt' executable (USE_WEBGL2, USE_GLFW, USE_OPENAL flags).
    # tilt_core itself needs no extra link libs.
else()
    # Link GLFW (only needed when OpenGL is enabled on native builds)
    if(ENABLE_OPENGL)
        if(TARGET glfw)
            target_link_libraries(tilt_core glfw)
        elseif(WINDOW_LIBRARY)
            target_link_libraries(tilt_core ${WINDOW_LIBRARY})
        endif()

        find_package(OpenGL)
        if(OPENGL_FOUND)
            target_link_libraries(tilt_core OpenGL::GL)
        endif()
    endif()

    # Link OpenAL
    if(TARGET OpenAL::OpenAL)
        target_link_libraries(tilt_core OpenAL::OpenAL)
    elseif(AUDIO_LIBRARY)
        target_link_libraries(tilt_core ${AUDIO_LIBRARY})
    endif()
endif()
