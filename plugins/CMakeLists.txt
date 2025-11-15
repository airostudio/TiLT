add_library(tilt_plugins STATIC
    dof/dof_plugin.cpp
    plugin_manager.cpp
)

target_include_directories(tilt_plugins PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(tilt_plugins
    tilt_core
)
