cmake_minimum_required(VERSION 3.20)
project(TiLT VERSION 1.0.0 LANGUAGES CXX C)

# Set C++ standard
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

# Options
option(BUILD_FRONTEND "Build the frontend application" ON)
option(BUILD_INSTALLER "Build the installer" ON)
option(ENABLE_VULKAN "Enable Vulkan renderer" ON)
option(ENABLE_OPENGL "Enable OpenGL renderer" ON)
option(ENABLE_DX12 "Enable DirectX 12 renderer (Windows only)" ON)
option(ENABLE_VR "Enable VR support" ON)
option(BUILD_TESTS "Build tests" OFF)
option(USE_SYSTEM_LIBS "Use system libraries instead of bundled vendor libs" ON)

# Platform detection
if(WIN32)
    set(PLATFORM_WINDOWS TRUE)
elseif(APPLE)
    set(PLATFORM_MACOS TRUE)
elseif(UNIX)
    set(PLATFORM_LINUX TRUE)
endif()

# Compiler flags
if(MSVC)
    add_compile_options(/W4 /WX- /MP)
    add_definitions(-D_CRT_SECURE_NO_WARNINGS)
else()
    add_compile_options(-Wall -Wextra -pedantic)
endif()

# ============================================================================
# External Library Detection
# ============================================================================

# Create vendor directory path
set(VENDOR_DIR ${CMAKE_SOURCE_DIR}/vendor)

# Find required libraries
if(USE_SYSTEM_LIBS)
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
else()
    message(STATUS "Using bundled vendor libraries from ${VENDOR_DIR}")
    # For now, we'll use system libs for complex libraries
    # and bundle header-only libs in vendor/
endif()

# Header-only libraries (bundled in vendor/)
include_directories(${VENDOR_DIR}/include)

# Add vendor subdirectory if it exists
if(EXISTS ${VENDOR_DIR}/CMakeLists.txt)
    add_subdirectory(vendor)
endif()

# ============================================================================

# Include directories
include_directories(
    ${CMAKE_SOURCE_DIR}/core
    ${CMAKE_SOURCE_DIR}/display
    ${CMAKE_SOURCE_DIR}/frontend
    ${CMAKE_SOURCE_DIR}/plugins
    ${CMAKE_SOURCE_DIR}/tools
)

# Subdirectories
add_subdirectory(core)
add_subdirectory(display)
add_subdirectory(plugins)
add_subdirectory(tools)

if(BUILD_FRONTEND)
    add_subdirectory(frontend)
endif()

if(BUILD_INSTALLER)
    add_subdirectory(installer)
endif()

# Main executable
add_executable(tilt
    main.cpp
)

target_link_libraries(tilt
    tilt_core
    tilt_display
    tilt_frontend
    tilt_plugins
)

# Install targets
install(TARGETS tilt DESTINATION bin)
install(DIRECTORY data/ DESTINATION share/tilt)
install(FILES README.md LICENSE IMPORT_GUIDE.md DESTINATION share/doc/tilt)
