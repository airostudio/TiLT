add_library(tilt_display STATIC
    backglass/backglass_renderer.cpp
    backglass/backglass_designer.cpp
    backglass/b2s_parser.cpp
    dmd/dmd_renderer.cpp
    playfield/playfield_renderer.cpp
)

target_include_directories(tilt_display PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(tilt_display
    tilt_core
)
