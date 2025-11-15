add_library(tilt_frontend STATIC
    launcher.cpp
    table_browser.cpp
    media_manager.cpp
    pup_engine.cpp
)

target_include_directories(tilt_frontend PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(tilt_frontend
    tilt_core
)
