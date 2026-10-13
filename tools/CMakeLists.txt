add_library(tilt_tools STATIC
    import_manager.cpp
    import_gui.cpp
    archive_extractor.cpp
    download_manager.cpp
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

# CURL for DownloadManager
if(TARGET CURL::libcurl)
    target_link_libraries(tilt_tools CURL::libcurl)
endif()

# nlohmann/json for DownloadManager
if(TARGET nlohmann_json::nlohmann_json)
    target_link_libraries(tilt_tools nlohmann_json::nlohmann_json)
endif()

# Import tool executable
add_executable(tilt-import
    tilt-import.cpp
)

target_link_libraries(tilt-import
    tilt_tools
    tilt_core
)

# Download tool executable
add_executable(tilt-download
    tilt-download.cpp
)

target_link_libraries(tilt-download
    tilt_tools
    tilt_core
)

# Install tools
install(TARGETS tilt-import tilt-download DESTINATION bin)
