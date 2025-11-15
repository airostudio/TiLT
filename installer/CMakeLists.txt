add_executable(tilt_installer
    main.cpp
    wizard.cpp
    package_manager.cpp
    auto_updater.cpp
)

target_include_directories(tilt_installer PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(tilt_installer
    tilt_core
)
