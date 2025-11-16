add_library(tilt_tools STATIC
    import_manager.cpp
    import_gui.cpp
)

target_include_directories(tilt_tools PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(tilt_tools
    tilt_core
)

# Import tool executable
add_executable(tilt-import
    tilt-import.cpp
)

target_link_libraries(tilt-import
    tilt_tools
    tilt_core
)

# Install import tool
install(TARGETS tilt-import DESTINATION bin)
