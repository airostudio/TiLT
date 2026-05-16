cmake_minimum_required(VERSION 3.20)
project(TiLT VERSION 1.0.0 LANGUAGES CXX C)

# Set C++ standard
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

# ============================================================================
# Options
# ============================================================================

option(BUILD_FRONTEND  "Build the frontend application"              ON)
option(BUILD_INSTALLER "Build the installer"                         ON)
option(ENABLE_VULKAN   "Enable Vulkan renderer"                      ON)
option(ENABLE_OPENGL   "Enable OpenGL renderer"                      ON)
option(ENABLE_DX12     "Enable DirectX 12 renderer (Windows only)"   ON)
option(ENABLE_VR       "Enable VR support"                           ON)
option(BUILD_TESTS     "Build tests"                                  OFF)
option(USE_SYSTEM_LIBS "Use system libraries instead of bundled vendor libs" ON)
option(ENABLE_WASM     "Build for WebAssembly via Emscripten"        OFF)

# ============================================================================
# Emscripten / WASM detection
# ============================================================================

# The Emscripten toolchain sets CMAKE_SYSTEM_NAME=Emscripten and defines the
# EMSCRIPTEN variable.  When that is detected we automatically enable the WASM
# path and disable native-only subsystems.
if(EMSCRIPTEN OR ENABLE_WASM)
    set(EMSCRIPTEN TRUE)  # normalise the flag name
    message(STATUS "[TiLT] Building for WebAssembly with Emscripten")

    # Emscripten provides its own GLFW, WebGL2, and OpenAL via link-time flags.
    # Disable native renderers and native find_package calls for these libs.
    set(ENABLE_VULKAN  OFF CACHE BOOL "" FORCE)
    set(ENABLE_OPENGL  OFF CACHE BOOL "" FORCE)
    set(ENABLE_DX12    OFF CACHE BOOL "" FORCE)
    set(ENABLE_VR      OFF CACHE BOOL "" FORCE)
    set(BUILD_FRONTEND OFF CACHE BOOL "" FORCE)
    set(BUILD_INSTALLER OFF CACHE BOOL "" FORCE)

    # Emscripten output is a .js loader + .wasm pair.
    set(CMAKE_EXECUTABLE_SUFFIX ".js")
endif()

# ============================================================================
# Platform detection (native builds only)
# ============================================================================

if(NOT EMSCRIPTEN)
    if(WIN32)
        set(PLATFORM_WINDOWS TRUE)
    elseif(APPLE)
        set(PLATFORM_MACOS TRUE)
    elseif(UNIX)
        set(PLATFORM_LINUX TRUE)
    endif()
endif()

# ============================================================================
# Compiler flags
# ============================================================================

if(MSVC)
    add_compile_options(/W4 /WX- /MP)
    add_definitions(-D_CRT_SECURE_NO_WARNINGS)
elseif(EMSCRIPTEN)
    # Emscripten inherits Clang; keep warnings but drop -pedantic (it fires on
    # Emscripten's own headers).
    add_compile_options(-Wall -Wextra)
else()
    add_compile_options(-Wall -Wextra -pedantic)
endif()

# ============================================================================
# External Library Detection  (native builds only)
# ============================================================================

set(VENDOR_DIR ${CMAKE_SOURCE_DIR}/vendor)

if(NOT EMSCRIPTEN AND USE_SYSTEM_LIBS)
    # LibArchive - Archive extraction (ZIP, RAR, 7z)
    find_package(LibArchive REQUIRED)
    if(LibArchive_FOUND)
        message(STATUS "Found LibArchive: ${LibArchive_VERSION}")
        set(ARCHIVE_LIBRARY LibArchive::LibArchive)
    endif()

    # GLFW - Window and input management
    if(ENABLE_OPENGL)
        find_package(glfw3 3.3 REQUIRED)
        if(glfw3_FOUND)
            message(STATUS "Found GLFW3: ${glfw3_VERSION}")
            set(WINDOW_LIBRARY glfw)
        endif()
    endif()

    # OpenAL - 3D audio
    find_package(OpenAL REQUIRED)
    if(OPENAL_FOUND)
        message(STATUS "Found OpenAL: ${OPENAL_LIBRARY}")
        set(AUDIO_LIBRARY OpenAL::OpenAL)
    endif()

    # pugixml - XML parsing
    find_package(pugixml REQUIRED)
    if(pugixml_FOUND)
        message(STATUS "Found pugixml: ${pugixml_VERSION}")
        set(XML_LIBRARY pugixml::pugixml)
    endif()

    # Vulkan SDK (optional)
    if(ENABLE_VULKAN)
        find_package(Vulkan)
        if(Vulkan_FOUND)
            message(STATUS "Found Vulkan: ${Vulkan_VERSION}")
        else()
            message(WARNING "Vulkan SDK not found - disabling Vulkan renderer")
            set(ENABLE_VULKAN OFF)
        endif()
    endif()
elseif(NOT EMSCRIPTEN)
    message(STATUS "Using bundled vendor libraries from ${VENDOR_DIR}")
endif()

# Header-only libraries (bundled in vendor/)
include_directories(${VENDOR_DIR}/include)

# Add vendor subdirectory if it exists
if(EXISTS ${VENDOR_DIR}/CMakeLists.txt)
    add_subdirectory(vendor)
endif()

# ============================================================================
# Include directories
# ============================================================================

include_directories(
    ${CMAKE_SOURCE_DIR}/core
)

if(NOT EMSCRIPTEN)
    include_directories(
        ${CMAKE_SOURCE_DIR}/display
        ${CMAKE_SOURCE_DIR}/frontend
        ${CMAKE_SOURCE_DIR}/plugins
        ${CMAKE_SOURCE_DIR}/tools
    )
endif()

# ============================================================================
# Subdirectories
# ============================================================================

add_subdirectory(core)

if(NOT EMSCRIPTEN)
    add_subdirectory(display)
    add_subdirectory(plugins)
    add_subdirectory(tools)

    if(BUILD_FRONTEND)
        add_subdirectory(frontend)
    endif()

    if(BUILD_INSTALLER)
        add_subdirectory(installer)
    endif()
endif()

# ============================================================================
# Main executable
# ============================================================================

add_executable(tilt main.cpp)

if(EMSCRIPTEN)
    target_link_libraries(tilt tilt_core)

    # Verify the shell file exists before referencing it
    set(TILT_SHELL_FILE "${CMAKE_SOURCE_DIR}/web/shell.html")
    if(NOT EXISTS "${TILT_SHELL_FILE}")
        message(WARNING "Emscripten shell file not found: ${TILT_SHELL_FILE}")
    endif()

    # Emscripten link flags
    target_link_options(tilt PRIVATE
        # WebGL2 / GLES3 context
        -sUSE_WEBGL2=1
        -sFULL_ES3=1
        # GLFW shim (keyboard/mouse/window events)
        -sUSE_GLFW=3
        # OpenAL via WebAudio
        -sUSE_OPENAL=1
        # Memory
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=134217728   # 128 MiB
        # Exported symbols so JS can call into the engine
        -sEXPORTED_FUNCTIONS=_main,_tilt_load_table_js,_tilt_unload_table
        -sEXPORTED_RUNTIME_METHODS=ccall,cwrap
        # Asyncify allows the C++ run-loop to yield to the browser event loop
        -sASYNCIFY=1
        # HTML shell
        --shell-file ${TILT_SHELL_FILE}
    )

    # Copy the generated .js + .wasm files next to the shell HTML so Vercel
    # can serve them directly from the web/ output directory.
    add_custom_command(TARGET tilt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy
            $<TARGET_FILE:tilt>
            "${CMAKE_SOURCE_DIR}/web/tilt.js"
        COMMENT "Copying tilt.js to web/"
    )
    add_custom_command(TARGET tilt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_CURRENT_BINARY_DIR}/tilt.wasm"
            "${CMAKE_SOURCE_DIR}/web/tilt.wasm"
        COMMENT "Copying tilt.wasm to web/"
    )
else()
    target_link_libraries(tilt
        tilt_core
        tilt_display
        tilt_frontend
        tilt_plugins
    )
endif()

# ============================================================================
# Install targets (native only)
# ============================================================================

if(NOT EMSCRIPTEN)
    install(TARGETS tilt DESTINATION bin)
    install(DIRECTORY data/ DESTINATION share/tilt)
    install(FILES README.md LICENSE IMPORT_GUIDE.md DESTINATION share/doc/tilt)
endif()
