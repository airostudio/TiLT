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
