/*
 * Import Manager - Intelligent ZIP file import system
 */

#ifndef TILT_IMPORT_MANAGER_HPP
#define TILT_IMPORT_MANAGER_HPP

#include <string>
#include <vector>
#include <map>
#include <functional>
#include <memory>

namespace tilt {

enum class FileType {
    Unknown,
    Table_VPX,
    Table_FP,
    Table_FPT,
    ROM,
    Backglass_DirectB2S,
    Backglass_B2SBackglass,
    Media_Image,
    Media_Video,
    Media_Wheel,
    PuPPack,
    Music,
    Sound,
    DMD,
    POV,
    Config,
    Script,
    Documentation
};

struct ImportedFile {
    std::string filename;
    std::string sourcePath;
    std::string destinationPath;
    FileType type;
    size_t size;
    bool imported;
    std::string error;
};

struct ImportPackage {
    std::string packageName;
    std::string sourceZip;
    std::vector<ImportedFile> files;
    size_t totalSize;
    int filesImported;
    bool completed;
};

class ImportManager {
public:
    ImportManager();
    ~ImportManager();

    // Import operations
    void importZipFile(const std::string& zipPath);
    void importMultipleZips(const std::vector<std::string>& zipPaths);
    void importDirectory(const std::string& dirPath);

    // File classification
    FileType classifyFile(const std::string& filename);
    std::string getDestinationPath(const std::string& filename, FileType type);

    // Package management
    std::vector<ImportPackage> getImportQueue() const { return importQueue_; }
    void clearImportQueue();

    // Progress tracking
    void setProgressCallback(std::function<void(int, int, const std::string&)> callback);
    int getTotalFiles() const;
    int getImportedFiles() const;

    // Validation
    bool validateZipFile(const std::string& zipPath);
    std::vector<std::string> previewZipContents(const std::string& zipPath);

    // Smart detection
    std::string detectTableName(const std::string& filename);
    std::string detectROMName(const std::string& tablePath);

    // Configuration
    void setBasePath(const std::string& path);
    void setAutoOrganize(bool enable) { autoOrganize_ = enable; }
    void setOverwriteExisting(bool enable) { overwriteExisting_ = enable; }
    void setCreateBackups(bool enable) { createBackups_ = enable; }

private:
    void extractZipFile(const std::string& zipPath, const std::string& extractTo);
    void processExtractedFiles(const std::string& extractPath, ImportPackage& package);
    void organizeFile(const ImportedFile& file);
    void createDirectoryStructure();
    bool isValidTableFile(const std::string& filename);
    bool isValidROMFile(const std::string& filename);
    std::string extractTableInfo(const std::string& tablePath);

    std::string basePath_;
    std::vector<ImportPackage> importQueue_;
    std::function<void(int, int, const std::string&)> progressCallback_;

    bool autoOrganize_;
    bool overwriteExisting_;
    bool createBackups_;

    std::map<std::string, FileType> extensionMap_;
    std::map<std::string, std::string> tableNameCache_;
};

} // namespace tilt

#endif // TILT_IMPORT_MANAGER_HPP
