add_library(tilt_tools STATIC
    import_manager.cpp
    import_gui.cpp
    archive_extractor.cpp
)

target_include_directories(tilt_tools PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(tilt_tools
    tilt_core
)

# Link LibArchive if available
if(TARGET LibArchive::LibArchive)
    target_link_libraries(tilt_tools LibArchive::LibArchive)
elseif(ARCHIVE_LIBRARY)
    target_link_libraries(tilt_tools ${ARCHIVE_LIBRARY})
endif()

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
