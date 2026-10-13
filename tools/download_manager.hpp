#pragma once

#include <string>
#include <vector>
#include <functional>
#include <memory>

namespace tilt {

enum class RepositoryType {
    InternetArchive,
    GoogleDrive
};

struct GameEntry {
    std::string id;           // unique key: "itemId/filename" or Drive file id
    std::string itemId;       // archive.org item identifier (empty for Drive)
    std::string filename;     // bare filename within the item/folder
    std::string title;
    std::string description;
    std::string downloadUrl;  // pre-built direct download URL
    uint64_t sizeBytes{0};
    RepositoryType source{RepositoryType::InternetArchive};
    std::vector<std::string> tags;
};

struct SearchResult {
    bool success{false};
    std::string errorMessage;
    std::vector<GameEntry> entries;
    int totalFound{0};
    int page{1};
    bool hasMore{false};
    std::string nextPageToken; // Google Drive pagination
};

struct DownloadResult {
    bool success{false};
    std::string errorMessage;
    std::string localPath;
    uint64_t bytesDownloaded{0};
    double durationSeconds{0.0};
};

// Return false to cancel the in-progress download.
using DownloadProgressCallback = std::function<bool(
    uint64_t bytesDownloaded,
    uint64_t totalBytes,
    double speedBytesPerSec
)>;

class DownloadManager {
public:
    DownloadManager();
    ~DownloadManager();

    // ------------------------------------------------------------------ //
    // Internet Archive
    // ------------------------------------------------------------------ //

    // Full-text search across archive.org (returns item-level results).
    SearchResult searchInternetArchive(const std::string& query,
                                       int page = 1,
                                       int pageSize = 50);

    // List all items inside a named collection (e.g. "Visual_Pinball_2020-06-20").
    SearchResult browseCollection(const std::string& collectionId,
                                  int page = 1,
                                  int pageSize = 50);

    // Expand one archive.org item into its individual downloadable files.
    // Only game-relevant extensions are returned (.vpx, .zip, .rom, etc.).
    SearchResult listItemFiles(const std::string& itemId);

    DownloadResult downloadFromArchive(const std::string& itemId,
                                       const std::string& filename,
                                       const std::string& destDir,
                                       DownloadProgressCallback callback = nullptr);

    // ------------------------------------------------------------------ //
    // Google Drive (public folders)
    // ------------------------------------------------------------------ //

    // List files in a publicly-shared Drive folder.
    // Requires setGoogleDriveApiKey() to be called first.
    // Pass nextPageToken from a previous SearchResult to page through results.
    SearchResult listGoogleDriveFolder(const std::string& folderId,
                                       const std::string& pageToken = "");

    DownloadResult downloadFromGoogleDrive(const std::string& fileId,
                                           const std::string& filename,
                                           const std::string& destDir,
                                           DownloadProgressCallback callback = nullptr);

    // ------------------------------------------------------------------ //
    // Configuration
    // ------------------------------------------------------------------ //

    void setGoogleDriveApiKey(const std::string& key);
    void setDownloadDirectory(const std::string& dir);
    void setTimeout(int seconds);             // connect timeout (default 30s)
    void setUserAgent(const std::string& ua);

    // ------------------------------------------------------------------ //
    // Utilities
    // ------------------------------------------------------------------ //

    static std::string formatBytes(uint64_t bytes);
    static std::string buildArchiveDownloadUrl(const std::string& itemId,
                                               const std::string& filename);
    static std::string buildGoogleDriveDownloadUrl(const std::string& fileId);

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;

    std::string m_googleApiKey;
    std::string m_downloadDir;
    int         m_timeoutSeconds{30};
    std::string m_userAgent{"TiLT/1.0 DownloadManager"};

    std::string httpGet(const std::string& url, int* outHttpCode = nullptr);

    DownloadResult downloadToFile(const std::string& url,
                                  const std::string& destPath,
                                  DownloadProgressCallback callback);

    // Resolves a Google Drive file URL, handling the large-file confirm redirect.
    std::string resolveGoogleDriveUrl(const std::string& fileId);
};

} // namespace tilt
