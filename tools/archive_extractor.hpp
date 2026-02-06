/*
 * Production Archive Extractor
 * Supports ZIP, RAR, 7z, tar, gzip, bzip2 using libarchive
 */

#pragma once

#include <string>
#include <vector>
#include <functional>
#include <memory>
#include <cstdint>

namespace tilt {

/**
 * Archive entry information
 */
struct ArchiveEntry {
    std::string pathname;      // Full path within archive
    uint64_t size;             // Uncompressed size
    uint64_t compressedSize;   // Compressed size
    bool isDirectory;          // True if directory
    time_t modificationTime;   // Last modification time
};

/**
 * Archive extraction result
 */
struct ExtractionResult {
    bool success;
    std::string errorMessage;
    size_t filesExtracted;
    size_t bytesExtracted;
    double durationSeconds;
};

/**
 * Progress callback
 * Parameters: currentFile, totalFiles, bytesProcessed, totalBytes
 * Return false to cancel extraction
 */
using ProgressCallback = std::function<bool(
    const std::string& currentFile,
    size_t currentFileIndex,
    size_t totalFiles,
    uint64_t bytesProcessed,
    uint64_t totalBytes
)>;

/**
 * Archive Format
 */
enum class ArchiveFormat {
    Unknown,
    ZIP,
    RAR,
    SevenZip,
    TAR,
    GZIP,
    BZIP2,
    XZ,
    ISO
};

/**
 * Archive Extractor
 * Thread-safe, production-quality archive extraction
 */
class ArchiveExtractor {
public:
    ArchiveExtractor();
    ~ArchiveExtractor();

    /**
     * List contents of archive without extracting
     */
    std::vector<ArchiveEntry> listContents(const std::string& archivePath);

    /**
     * Extract archive to destination directory
     * @param archivePath Path to archive file
     * @param destPath Destination directory
     * @param password Optional password for encrypted archives
     * @param callback Optional progress callback
     * @return Extraction result
     */
    ExtractionResult extract(
        const std::string& archivePath,
        const std::string& destPath,
        const std::string& password = "",
        ProgressCallback callback = nullptr
    );

    /**
     * Extract specific files from archive
     * @param archivePath Path to archive file
     * @param destPath Destination directory
     * @param filesToExtract List of files to extract (relative paths within archive)
     * @param password Optional password
     * @param callback Optional progress callback
     * @return Extraction result
     */
    ExtractionResult extractFiles(
        const std::string& archivePath,
        const std::string& destPath,
        const std::vector<std::string>& filesToExtract,
        const std::string& password = "",
        ProgressCallback callback = nullptr
    );

    /**
     * Detect archive format
     */
    static ArchiveFormat detectFormat(const std::string& archivePath);

    /**
     * Get format name as string
     */
    static std::string formatToString(ArchiveFormat format);

    /**
     * Check if file is a supported archive
     */
    static bool isSupportedArchive(const std::string& filePath);

    /**
     * Verify archive integrity
     */
    bool verifyArchive(const std::string& archivePath, std::string& errorMessage);

    /**
     * Get archive information (total size, file count, etc.)
     */
    struct ArchiveInfo {
        ArchiveFormat format;
        size_t fileCount;
        size_t directoryCount;
        uint64_t totalUncompressedSize;
        uint64_t totalCompressedSize;
        bool isEncrypted;
        std::string comment;
    };

    ArchiveInfo getArchiveInfo(const std::string& archivePath);

    /**
     * Configuration options
     */
    void setOverwriteExisting(bool overwrite) { overwriteExisting_ = overwrite; }
    void setPreservePermissions(bool preserve) { preservePermissions_ = preserve; }
    void setPreserveTimestamps(bool preserve) { preserveTimestamps_ = preserve; }
    void setFollowSymlinks(bool follow) { followSymlinks_ = follow; }
    void setValidateCRC(bool validate) { validateCRC_ = validate; }

private:
    // Configuration
    bool overwriteExisting_;
    bool preservePermissions_;
    bool preserveTimestamps_;
    bool followSymlinks_;
    bool validateCRC_;

    // Internal extraction implementation
    ExtractionResult extractInternal(
        const std::string& archivePath,
        const std::string& destPath,
        const std::string& password,
        const std::vector<std::string>* filesToExtract,
        ProgressCallback callback
    );

    // Helper functions
    bool createDirectoryRecursive(const std::string& path);
    bool setFilePermissions(const std::string& path, mode_t mode);
    bool setFileTimestamp(const std::string& path, time_t mtime);
    std::string sanitizePath(const std::string& path);
    bool isPathSafe(const std::string& path, const std::string& basePath);
};

} // namespace tilt
