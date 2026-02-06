/*
 * Import Manager Implementation
 */

#include "import_manager.hpp"
#include "archive_extractor.hpp"
#include <iostream>
#include <fstream>
#include <filesystem>
#include <algorithm>
#include <regex>

namespace fs = std::filesystem;

namespace tilt {

ImportManager::ImportManager()
    : basePath_("./data")
    , autoOrganize_(true)
    , overwriteExisting_(false)
    , createBackups_(true)
{
    std::cout << "[Import Manager] Initialized" << std::endl;

    // Build extension map for file classification
    extensionMap_ = {
        // Tables
        {".vpx", FileType::Table_VPX},
        {".vpt", FileType::Table_VPX},
        {".fpt", FileType::Table_FPT},
        {".fp", FileType::Table_FP},

        // ROMs (can be ZIP, RAR, or 7z)
        {".zip", FileType::ROM},
        {".rar", FileType::ROM},
        {".7z", FileType::ROM},
        {".u6", FileType::ROM},
        {".u2", FileType::ROM},

        // Backglasses
        {".directb2s", FileType::Backglass_DirectB2S},
        {".b2s", FileType::Backglass_DirectB2S},
        {".b2sbackglass", FileType::Backglass_B2SBackglass},

        // Media - Images
        {".png", FileType::Media_Image},
        {".jpg", FileType::Media_Image},
        {".jpeg", FileType::Media_Image},
        {".bmp", FileType::Media_Image},
        {".gif", FileType::Media_Image},

        // Media - Videos
        {".mp4", FileType::Media_Video},
        {".avi", FileType::Media_Video},
        {".mkv", FileType::Media_Video},
        {".webm", FileType::Media_Video},
        {".mov", FileType::Media_Video},
        {".wmv", FileType::Media_Video},

        // Audio
        {".mp3", FileType::Music},
        {".ogg", FileType::Music},
        {".wav", FileType::Sound},
        {".flac", FileType::Music},

        // PuP Packs
        {".pup", FileType::PuPPack},

        // DMD
        {".cRZ", FileType::DMD},
        {".pal", FileType::DMD},

        // POV (camera settings)
        {".pov", FileType::POV},

        // Config
        {".ini", FileType::Config},
        {".cfg", FileType::Config},
        {".conf", FileType::Config},

        // Scripts
        {".vbs", FileType::Script},
        {".lua", FileType::Script},

        // Documentation
        {".txt", FileType::Documentation},
        {".pdf", FileType::Documentation},
        {".md", FileType::Documentation}
    };

    createDirectoryStructure();
}

ImportManager::~ImportManager() {}

void ImportManager::createDirectoryStructure() {
    // Create standard directory structure
    std::vector<std::string> dirs = {
        basePath_ + "/tables",
        basePath_ + "/roms",
        basePath_ + "/backglasses",
        basePath_ + "/media/artwork",
        basePath_ + "/media/videos",
        basePath_ + "/media/wheels",
        basePath_ + "/media/screenshots",
        basePath_ + "/media/audio",
        basePath_ + "/pup",
        basePath_ + "/config",
        basePath_ + "/scripts",
        basePath_ + "/dmd",
        basePath_ + "/backups"
    };

    for (const auto& dir : dirs) {
        fs::create_directories(dir);
    }
}

FileType ImportManager::classifyFile(const std::string& filename) {
    // Get file extension
    fs::path filePath(filename);
    std::string ext = filePath.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

    // Check extension map
    auto it = extensionMap_.find(ext);
    if (it != extensionMap_.end()) {
        // Special handling for archive files - could be ROM or table pack
        if (ext == ".zip" || ext == ".rar" || ext == ".7z") {
            // Check if it's in a ROM context
            std::string lower = filename;
            std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

            if (lower.find("rom") != std::string::npos ||
                isValidROMFile(filename)) {
                return FileType::ROM;
            }
        }
        return it->second;
    }

    // Special pattern matching
    std::string lower = filename;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

    // Check for common patterns
    if (lower.find("wheel") != std::string::npos) {
        return FileType::Media_Wheel;
    }
    if (lower.find("pup") != std::string::npos && ext == ".zip") {
        return FileType::PuPPack;
    }
    if (lower.find("backglass") != std::string::npos) {
        return FileType::Backglass_DirectB2S;
    }

    return FileType::Unknown;
}

std::string ImportManager::getDestinationPath(const std::string& filename, FileType type) {
    fs::path file(filename);
    std::string name = file.filename().string();

    switch (type) {
        case FileType::Table_VPX:
        case FileType::Table_FP:
        case FileType::Table_FPT:
            return basePath_ + "/tables/" + name;

        case FileType::ROM:
            return basePath_ + "/roms/" + name;

        case FileType::Backglass_DirectB2S:
        case FileType::Backglass_B2SBackglass:
            return basePath_ + "/backglasses/" + name;

        case FileType::Media_Wheel:
            return basePath_ + "/media/wheels/" + name;

        case FileType::Media_Image: {
            // Determine if it's artwork or screenshot
            std::string lower = name;
            std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
            if (lower.find("screen") != std::string::npos) {
                return basePath_ + "/media/screenshots/" + name;
            }
            return basePath_ + "/media/artwork/" + name;
        }

        case FileType::Media_Video:
            return basePath_ + "/media/videos/" + name;

        case FileType::Music:
        case FileType::Sound:
            return basePath_ + "/media/audio/" + name;

        case FileType::PuPPack:
            return basePath_ + "/pup/" + name;

        case FileType::DMD:
            return basePath_ + "/dmd/" + name;

        case FileType::POV:
            return basePath_ + "/config/" + name;

        case FileType::Config:
            return basePath_ + "/config/" + name;

        case FileType::Script:
            return basePath_ + "/scripts/" + name;

        case FileType::Documentation:
            return basePath_ + "/docs/" + name;

        default:
            return basePath_ + "/misc/" + name;
    }
}

void ImportManager::importZipFile(const std::string& zipPath) {
    std::cout << "[Import Manager] Importing: " << zipPath << std::endl;

    if (!validateZipFile(zipPath)) {
        std::cerr << "[Import Manager] Invalid ZIP file: " << zipPath << std::endl;
        return;
    }

    ImportPackage package;
    package.sourceZip = zipPath;
    package.packageName = fs::path(zipPath).stem().string();
    package.completed = false;
    package.filesImported = 0;
    package.totalSize = 0;

    // Create temporary extraction directory
    std::string extractPath = fs::temp_directory_path().string() + "/tilt_import_" + package.packageName;
    fs::create_directories(extractPath);

    try {
        // Extract ZIP file
        std::cout << "[Import Manager] Extracting to: " << extractPath << std::endl;
        extractZipFile(zipPath, extractPath);

        // Process extracted files
        processExtractedFiles(extractPath, package);

        // Organize files
        for (auto& file : package.files) {
            try {
                organizeFile(file);
                file.imported = true;
                package.filesImported++;

                if (progressCallback_) {
                    progressCallback_(package.filesImported, package.files.size(), file.filename);
                }
            }
            catch (const std::exception& e) {
                file.error = e.what();
                std::cerr << "[Import Manager] Error importing " << file.filename << ": " << e.what() << std::endl;
            }
        }

        package.completed = true;
        importQueue_.push_back(package);

        // Cleanup temporary directory
        fs::remove_all(extractPath);

        std::cout << "[Import Manager] Import completed: " << package.filesImported << "/"
                  << package.files.size() << " files" << std::endl;
    }
    catch (const std::exception& e) {
        std::cerr << "[Import Manager] Import failed: " << e.what() << std::endl;
        fs::remove_all(extractPath);
    }
}

void ImportManager::importMultipleZips(const std::vector<std::string>& zipPaths) {
    std::cout << "[Import Manager] Batch importing " << zipPaths.size() << " packages..." << std::endl;

    for (const auto& zipPath : zipPaths) {
        importZipFile(zipPath);
    }

    std::cout << "[Import Manager] Batch import completed" << std::endl;
}

void ImportManager::extractZipFile(const std::string& zipPath, const std::string& extractTo) {
    std::cout << "[Import Manager] Extracting archive: " << zipPath << std::endl;

    // Create archive extractor
    ArchiveExtractor extractor;
    extractor.setOverwriteExisting(true);
    extractor.setPreserveTimestamps(true);
    extractor.setPreservePermissions(true);

    // Progress callback for extraction
    auto progressCb = [](const std::string& currentFile, size_t current, size_t total,
                         uint64_t bytesProcessed, uint64_t totalBytes) -> bool {
        if (total > 0) {
            int percent = static_cast<int>((current * 100) / total);
            std::cout << "\r[Import Manager] Extracting... " << percent << "% ("
                      << current << "/" << total << " files)" << std::flush;
        }
        return true; // Continue extraction
    };

    // Extract archive
    ExtractionResult result = extractor.extract(zipPath, extractTo, "", progressCb);

    std::cout << std::endl; // New line after progress

    if (!result.success) {
        throw std::runtime_error("Archive extraction failed: " + result.errorMessage);
    }

    std::cout << "[Import Manager] Extracted " << result.filesExtracted
              << " files (" << (result.bytesExtracted / 1024.0 / 1024.0) << " MB) in "
              << result.durationSeconds << " seconds" << std::endl;
}

void ImportManager::processExtractedFiles(const std::string& extractPath, ImportPackage& package) {
    std::cout << "[Import Manager] Processing extracted files from: " << extractPath << std::endl;

    // Recursively scan extracted directory
    for (const auto& entry : fs::recursive_directory_iterator(extractPath)) {
        if (entry.is_regular_file()) {
            ImportedFile file;
            file.filename = entry.path().filename().string();
            file.sourcePath = entry.path().string();
            file.type = classifyFile(file.filename);
            file.destinationPath = getDestinationPath(file.filename, file.type);
            file.size = entry.file_size();
            file.imported = false;

            package.files.push_back(file);
            package.totalSize += file.size;

            std::cout << "[Import Manager]   Found: " << file.filename
                      << " (" << file.size << " bytes) -> Type: " << static_cast<int>(file.type) << std::endl;
        }
    }

    std::cout << "[Import Manager] Found " << package.files.size() << " files" << std::endl;
}

void ImportManager::organizeFile(const ImportedFile& file) {
    std::cout << "[Import Manager] Organizing: " << file.filename << std::endl;
    std::cout << "[Import Manager]   From: " << file.sourcePath << std::endl;
    std::cout << "[Import Manager]   To: " << file.destinationPath << std::endl;

    // Create destination directory if it doesn't exist
    fs::path destPath(file.destinationPath);
    fs::create_directories(destPath.parent_path());

    // Check if file already exists
    if (fs::exists(file.destinationPath)) {
        if (!overwriteExisting_) {
            throw std::runtime_error("File already exists: " + file.destinationPath);
        }

        // Create backup if enabled
        if (createBackups_) {
            std::string backupPath = basePath_ + "/backups/" + file.filename + ".bak";
            fs::copy_file(file.destinationPath, backupPath, fs::copy_options::overwrite_existing);
            std::cout << "[Import Manager]   Created backup: " << backupPath << std::endl;
        }
    }

    // Copy file to destination
    fs::copy_file(file.sourcePath, file.destinationPath, fs::copy_options::overwrite_existing);
}

bool ImportManager::validateZipFile(const std::string& zipPath) {
    if (!fs::exists(zipPath)) {
        std::cerr << "[Import Manager] File not found: " << zipPath << std::endl;
        return false;
    }

    // Check if it's a supported archive format
    if (!ArchiveExtractor::isSupportedArchive(zipPath)) {
        std::cerr << "[Import Manager] Unsupported archive format: " << zipPath << std::endl;
        return false;
    }

    // Verify archive integrity
    ArchiveExtractor extractor;
    std::string errorMessage;
    if (!extractor.verifyArchive(zipPath, errorMessage)) {
        std::cerr << "[Import Manager] Archive verification failed: " << errorMessage << std::endl;
        return false;
    }

    return true;
}

std::vector<std::string> ImportManager::previewZipContents(const std::string& zipPath) {
    std::vector<std::string> contents;

    std::cout << "[Import Manager] Previewing archive: " << zipPath << std::endl;

    // Create archive extractor and list contents
    ArchiveExtractor extractor;
    auto entries = extractor.listContents(zipPath);

    // Get archive info
    auto info = extractor.getArchiveInfo(zipPath);
    std::cout << "[Import Manager] Archive format: " << ArchiveExtractor::formatToString(info.format) << std::endl;
    std::cout << "[Import Manager] Total files: " << info.fileCount << std::endl;
    std::cout << "[Import Manager] Total size: " << (info.totalUncompressedSize / 1024.0 / 1024.0) << " MB" << std::endl;
    if (info.isEncrypted) {
        std::cout << "[Import Manager] WARNING: Archive is password protected" << std::endl;
    }

    // Extract filenames
    for (const auto& entry : entries) {
        contents.push_back(entry.pathname);
        std::cout << "[Import Manager]   - " << entry.pathname
                  << " (" << (entry.size / 1024.0) << " KB)" << std::endl;
    }

    return contents;
}

std::string ImportManager::detectTableName(const std::string& filename) {
    // Check cache first
    auto it = tableNameCache_.find(filename);
    if (it != tableNameCache_.end()) {
        return it->second;
    }

    // Extract name from filename
    fs::path file(filename);
    std::string name = file.stem().string();

    // Common patterns to clean up
    std::regex patterns[] = {
        std::regex("_\\d+$"),           // Remove version numbers like _109
        std::regex("\\([^)]*\\)"),      // Remove parentheses content
        std::regex("\\[[^]]*\\]"),      // Remove brackets content
        std::regex("_+"),               // Replace multiple underscores
    };

    for (const auto& pattern : patterns) {
        name = std::regex_replace(name, pattern, " ");
    }

    // Clean up spaces
    name = std::regex_replace(name, std::regex("\\s+"), " ");
    name = std::regex_replace(name, std::regex("^\\s+|\\s+$"), "");

    tableNameCache_[filename] = name;
    return name;
}

std::string ImportManager::detectROMName(const std::string& tablePath) {
    // Try to extract ROM name from table file
    // This would actually parse the VPX/FP file

    std::string tableName = detectTableName(tablePath);

    // Common ROM naming patterns
    std::transform(tableName.begin(), tableName.end(), tableName.begin(), ::tolower);
    tableName = std::regex_replace(tableName, std::regex("\\s+"), "_");

    return tableName;
}

bool ImportManager::isValidTableFile(const std::string& filename) {
    FileType type = classifyFile(filename);
    return type == FileType::Table_VPX ||
           type == FileType::Table_FP ||
           type == FileType::Table_FPT;
}

bool ImportManager::isValidROMFile(const std::string& filename) {
    // Check if filename matches ROM naming patterns
    std::regex romPattern("^[a-z0-9_]+_[0-9]+[a-z]?\\.zip$", std::regex::icase);
    return std::regex_match(fs::path(filename).filename().string(), romPattern);
}

void ImportManager::setProgressCallback(std::function<void(int, int, const std::string&)> callback) {
    progressCallback_ = callback;
}

int ImportManager::getTotalFiles() const {
    int total = 0;
    for (const auto& package : importQueue_) {
        total += package.files.size();
    }
    return total;
}

int ImportManager::getImportedFiles() const {
    int imported = 0;
    for (const auto& package : importQueue_) {
        imported += package.filesImported;
    }
    return imported;
}

void ImportManager::clearImportQueue() {
    importQueue_.clear();
}

void ImportManager::setBasePath(const std::string& path) {
    basePath_ = path;
    createDirectoryStructure();
}

void ImportManager::importDirectory(const std::string& dirPath) {
    std::cout << "[Import Manager] Scanning directory: " << dirPath << std::endl;

    // Find all supported archive files in directory
    std::vector<std::string> archiveFiles;
    for (const auto& entry : fs::directory_iterator(dirPath)) {
        if (entry.is_regular_file()) {
            std::string path = entry.path().string();
            if (ArchiveExtractor::isSupportedArchive(path)) {
                archiveFiles.push_back(path);
            }
        }
    }

    if (!archiveFiles.empty()) {
        std::cout << "[Import Manager] Found " << archiveFiles.size() << " archive files" << std::endl;
        importMultipleZips(archiveFiles);
    } else {
        std::cout << "[Import Manager] No supported archive files found in: " << dirPath << std::endl;
    }
}

} // namespace tilt
