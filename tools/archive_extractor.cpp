/*
 * Production Archive Extractor Implementation
 * Uses libarchive for robust multi-format support
 */

#include "archive_extractor.hpp"
#include <archive.h>
#include <archive_entry.h>
#include <iostream>
#include <filesystem>
#include <chrono>
#include <cstring>
#include <algorithm>
#include <sys/stat.h>

namespace fs = std::filesystem;

namespace tilt {

ArchiveExtractor::ArchiveExtractor()
    : overwriteExisting_(true)
    , preservePermissions_(true)
    , preserveTimestamps_(true)
    , followSymlinks_(false)
    , validateCRC_(true)
{
}

ArchiveExtractor::~ArchiveExtractor() {
}

std::vector<ArchiveEntry> ArchiveExtractor::listContents(const std::string& archivePath) {
    std::vector<ArchiveEntry> entries;

    struct archive* a = archive_read_new();
    archive_read_support_filter_all(a);
    archive_read_support_format_all(a);

    if (archive_read_open_filename(a, archivePath.c_str(), 10240) != ARCHIVE_OK) {
        std::cerr << "[Archive] Failed to open: " << archive_error_string(a) << std::endl;
        archive_read_free(a);
        return entries;
    }

    struct archive_entry* entry;
    while (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
        ArchiveEntry info;
        info.pathname = archive_entry_pathname(entry);
        info.size = archive_entry_size(entry);
        info.isDirectory = (archive_entry_filetype(entry) == AE_IFDIR);
        info.modificationTime = archive_entry_mtime(entry);

        // Compressed size is not always available
        info.compressedSize = info.size;

        entries.push_back(info);
        archive_read_data_skip(a);
    }

    archive_read_free(a);
    return entries;
}

ExtractionResult ArchiveExtractor::extract(
    const std::string& archivePath,
    const std::string& destPath,
    const std::string& password,
    ProgressCallback callback)
{
    return extractInternal(archivePath, destPath, password, nullptr, callback);
}

ExtractionResult ArchiveExtractor::extractFiles(
    const std::string& archivePath,
    const std::string& destPath,
    const std::vector<std::string>& filesToExtract,
    const std::string& password,
    ProgressCallback callback)
{
    return extractInternal(archivePath, destPath, password, &filesToExtract, callback);
}

ExtractionResult ArchiveExtractor::extractInternal(
    const std::string& archivePath,
    const std::string& destPath,
    const std::string& password,
    const std::vector<std::string>* filesToExtract,
    ProgressCallback callback)
{
    auto startTime = std::chrono::high_resolution_clock::now();

    ExtractionResult result;
    result.success = false;
    result.filesExtracted = 0;
    result.bytesExtracted = 0;

    // Verify archive exists
    if (!fs::exists(archivePath)) {
        result.errorMessage = "Archive file does not exist: " + archivePath;
        return result;
    }

    // Create destination directory
    if (!createDirectoryRecursive(destPath)) {
        result.errorMessage = "Failed to create destination directory: " + destPath;
        return result;
    }

    // Get absolute destination path for security checks
    std::string absDestPath = fs::absolute(destPath).string();

    // Open archive for reading
    struct archive* a = archive_read_new();
    archive_read_support_filter_all(a);
    archive_read_support_format_all(a);

    // Set password if provided
    if (!password.empty()) {
        archive_read_add_passphrase(a, password.c_str());
    }

    if (archive_read_open_filename(a, archivePath.c_str(), 10240) != ARCHIVE_OK) {
        result.errorMessage = std::string("Failed to open archive: ") + archive_error_string(a);
        archive_read_free(a);
        return result;
    }

    // Get total file count for progress
    auto entries = listContents(archivePath);
    size_t totalFiles = entries.size();
    uint64_t totalBytes = 0;
    for (const auto& entry : entries) {
        totalBytes += entry.size;
    }

    // Extract files
    struct archive* ext = archive_write_disk_new();
    archive_write_disk_set_options(ext,
        ARCHIVE_EXTRACT_TIME |
        ARCHIVE_EXTRACT_PERM |
        ARCHIVE_EXTRACT_ACL |
        ARCHIVE_EXTRACT_FFLAGS);
    archive_write_disk_set_standard_lookup(ext);

    struct archive_entry* entry;
    size_t currentFileIndex = 0;
    uint64_t bytesProcessed = 0;
    bool cancelled = false;

    while (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
        std::string pathname = archive_entry_pathname(entry);

        // Check if we should extract this file
        if (filesToExtract != nullptr) {
            bool shouldExtract = false;
            for (const auto& file : *filesToExtract) {
                if (pathname == file) {
                    shouldExtract = true;
                    break;
                }
            }
            if (!shouldExtract) {
                archive_read_data_skip(a);
                continue;
            }
        }

        // Sanitize and validate path
        std::string sanitizedPath = sanitizePath(pathname);
        std::string fullPath = (fs::path(absDestPath) / sanitizedPath).string();

        // Security check: prevent directory traversal
        if (!isPathSafe(fullPath, absDestPath)) {
            std::cerr << "[Archive] Blocked unsafe path: " << pathname << std::endl;
            archive_read_data_skip(a);
            continue;
        }

        // Update archive entry with new path
        archive_entry_set_pathname(entry, fullPath.c_str());

        // Check if file exists and overwrite settings
        if (!overwriteExisting_ && fs::exists(fullPath)) {
            std::cerr << "[Archive] Skipping existing file: " << pathname << std::endl;
            archive_read_data_skip(a);
            continue;
        }

        // Write header
        int r = archive_write_header(ext, entry);
        if (r != ARCHIVE_OK) {
            std::cerr << "[Archive] Header write failed: " << archive_error_string(ext) << std::endl;
        } else {
            // Copy data
            const void* buff;
            size_t size;
            int64_t offset;

            while (true) {
                r = archive_read_data_block(a, &buff, &size, &offset);
                if (r == ARCHIVE_EOF) {
                    break;
                }
                if (r != ARCHIVE_OK) {
                    result.errorMessage = std::string("Read error: ") + archive_error_string(a);
                    break;
                }

                r = archive_write_data_block(ext, buff, size, offset);
                if (r != ARCHIVE_OK) {
                    result.errorMessage = std::string("Write error: ") + archive_error_string(ext);
                    break;
                }

                bytesProcessed += size;
            }

            r = archive_write_finish_entry(ext);
            if (r != ARCHIVE_OK) {
                std::cerr << "[Archive] Finish entry failed: " << archive_error_string(ext) << std::endl;
            }

            result.filesExtracted++;
            result.bytesExtracted += archive_entry_size(entry);

            // Preserve timestamps if requested
            if (preserveTimestamps_) {
                setFileTimestamp(fullPath, archive_entry_mtime(entry));
            }
        }

        // Progress callback
        if (callback) {
            currentFileIndex++;
            bool shouldContinue = callback(pathname, currentFileIndex, totalFiles,
                                          bytesProcessed, totalBytes);
            if (!shouldContinue) {
                cancelled = true;
                result.errorMessage = "Extraction cancelled by user";
                break;
            }
        }
    }

    archive_read_close(a);
    archive_read_free(a);
    archive_write_close(ext);
    archive_write_free(ext);

    auto endTime = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> duration = endTime - startTime;
    result.durationSeconds = duration.count();

    if (!cancelled && result.errorMessage.empty()) {
        result.success = true;
    }

    return result;
}

ArchiveFormat ArchiveExtractor::detectFormat(const std::string& archivePath) {
    struct archive* a = archive_read_new();
    archive_read_support_filter_all(a);
    archive_read_support_format_all(a);

    if (archive_read_open_filename(a, archivePath.c_str(), 10240) != ARCHIVE_OK) {
        archive_read_free(a);
        return ArchiveFormat::Unknown;
    }

    int format = archive_format(a);
    archive_read_free(a);

    // Map libarchive format codes to our enum
    if (format & ARCHIVE_FORMAT_ZIP) return ArchiveFormat::ZIP;
    if (format & ARCHIVE_FORMAT_RAR) return ArchiveFormat::RAR;
    if (format & ARCHIVE_FORMAT_7ZIP) return ArchiveFormat::SevenZip;
    if (format & ARCHIVE_FORMAT_TAR) return ArchiveFormat::TAR;
    if (format & ARCHIVE_FORMAT_ISO9660) return ArchiveFormat::ISO;

    return ArchiveFormat::Unknown;
}

std::string ArchiveExtractor::formatToString(ArchiveFormat format) {
    switch (format) {
        case ArchiveFormat::ZIP: return "ZIP";
        case ArchiveFormat::RAR: return "RAR";
        case ArchiveFormat::SevenZip: return "7-Zip";
        case ArchiveFormat::TAR: return "TAR";
        case ArchiveFormat::GZIP: return "GZIP";
        case ArchiveFormat::BZIP2: return "BZIP2";
        case ArchiveFormat::XZ: return "XZ";
        case ArchiveFormat::ISO: return "ISO";
        default: return "Unknown";
    }
}

bool ArchiveExtractor::isSupportedArchive(const std::string& filePath) {
    std::string ext = fs::path(filePath).extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

    return (ext == ".zip" || ext == ".rar" || ext == ".7z" ||
            ext == ".tar" || ext == ".gz" || ext == ".bz2" ||
            ext == ".xz" || ext == ".iso");
}

bool ArchiveExtractor::verifyArchive(const std::string& archivePath, std::string& errorMessage) {
    struct archive* a = archive_read_new();
    archive_read_support_filter_all(a);
    archive_read_support_format_all(a);

    if (archive_read_open_filename(a, archivePath.c_str(), 10240) != ARCHIVE_OK) {
        errorMessage = archive_error_string(a);
        archive_read_free(a);
        return false;
    }

    struct archive_entry* entry;
    bool valid = true;

    while (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
        if (validateCRC_) {
            // Read through all data to verify checksums
            const void* buff;
            size_t size;
            int64_t offset;

            while (archive_read_data_block(a, &buff, &size, &offset) == ARCHIVE_OK) {
                // Just reading through validates CRC
            }
        } else {
            archive_read_data_skip(a);
        }
    }

    if (archive_errno(a) != 0) {
        errorMessage = archive_error_string(a);
        valid = false;
    }

    archive_read_free(a);
    return valid;
}

ArchiveExtractor::ArchiveInfo ArchiveExtractor::getArchiveInfo(const std::string& archivePath) {
    ArchiveInfo info;
    info.format = detectFormat(archivePath);
    info.fileCount = 0;
    info.directoryCount = 0;
    info.totalUncompressedSize = 0;
    info.totalCompressedSize = 0;
    info.isEncrypted = false;

    auto entries = listContents(archivePath);
    for (const auto& entry : entries) {
        if (entry.isDirectory) {
            info.directoryCount++;
        } else {
            info.fileCount++;
        }
        info.totalUncompressedSize += entry.size;
        info.totalCompressedSize += entry.compressedSize;
    }

    return info;
}

bool ArchiveExtractor::createDirectoryRecursive(const std::string& path) {
    try {
        return fs::create_directories(path);
    } catch (const fs::filesystem_error& e) {
        std::cerr << "[Archive] Directory creation failed: " << e.what() << std::endl;
        return false;
    }
}

bool ArchiveExtractor::setFilePermissions(const std::string& path, mode_t mode) {
    #ifndef _WIN32
    if (chmod(path.c_str(), mode) != 0) {
        std::cerr << "[Archive] Failed to set permissions: " << path << std::endl;
        return false;
    }
    #endif
    return true;
}

bool ArchiveExtractor::setFileTimestamp(const std::string& path, time_t mtime) {
    try {
        auto ftime = fs::file_time_type::clock::from_time_t(mtime);
        fs::last_write_time(path, ftime);
        return true;
    } catch (const fs::filesystem_error& e) {
        std::cerr << "[Archive] Failed to set timestamp: " << e.what() << std::endl;
        return false;
    }
}

std::string ArchiveExtractor::sanitizePath(const std::string& path) {
    std::string sanitized = path;

    // Remove leading slashes and backslashes
    while (!sanitized.empty() && (sanitized[0] == '/' || sanitized[0] == '\\')) {
        sanitized.erase(0, 1);
    }

    // Replace backslashes with forward slashes
    std::replace(sanitized.begin(), sanitized.end(), '\\', '/');

    return sanitized;
}

bool ArchiveExtractor::isPathSafe(const std::string& path, const std::string& basePath) {
    try {
        fs::path fullPath = fs::absolute(path);
        fs::path base = fs::absolute(basePath);

        // Check if path is within base directory
        auto [rootEnd, nothing] = std::mismatch(base.begin(), base.end(),
                                                fullPath.begin(), fullPath.end());

        return rootEnd == base.end();
    } catch (const fs::filesystem_error&) {
        return false;
    }
}

} // namespace tilt
