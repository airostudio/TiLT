// tilt-download: command-line tool for browsing and downloading games on demand.
//
// Usage:
//   tilt-download search <query>
//   tilt-download browse <archive-collection-id>
//   tilt-download files  <archive-item-id>
//   tilt-download get    <archive-item-id> <filename> [dest-dir]
//   tilt-download drive-list  <folder-id> --key <api-key>
//   tilt-download drive-get   <file-id>   <filename> [dest-dir] --key <api-key>

#include "download_manager.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>

using namespace tilt;

static void printUsage() {
    std::cout << R"(Usage:
  tilt-download search  <query>                          Search Internet Archive
  tilt-download browse  <collection-id>                  Browse an IA collection
  tilt-download files   <item-id>                        List files in an IA item
  tilt-download get     <item-id> <filename> [dest-dir]  Download from Archive.org
  tilt-download drive-list <folder-id> --key <api-key>   List a public Drive folder
  tilt-download drive-get  <file-id> <filename> [dest] --key <key>  Download from Drive

Examples:
  tilt-download search "pinball vpx"
  tilt-download browse Visual_Pinball_2020-06-20
  tilt-download files  epicpinballcompletecollection
  tilt-download get    epicpinballcompletecollection "Epic Pinball.zip" ~/Downloads
  tilt-download drive-list 1AbCdEfGhIjKlMn --key AIza...
  tilt-download drive-get  1XyZ... "game.vpx" ~/Downloads --key AIza...
)" << "\n";
}

static std::string argValue(const std::vector<std::string>& args,
                             const std::string& flag,
                             const std::string& defaultVal = "") {
    for (size_t i = 0; i + 1 < args.size(); ++i)
        if (args[i] == flag) return args[i + 1];
    return defaultVal;
}

static void printEntries(const SearchResult& r) {
    if (!r.success) {
        std::cerr << "Error: " << r.errorMessage << "\n";
        return;
    }
    std::cout << "Found " << r.totalFound << " result(s)";
    if (r.hasMore) std::cout << " (showing first page)";
    std::cout << "\n\n";

    for (const auto& e : r.entries) {
        std::cout << "  Title   : " << e.title << "\n";
        if (!e.id.empty())       std::cout << "  ID      : " << e.id << "\n";
        if (!e.filename.empty()) std::cout << "  File    : " << e.filename << "\n";
        if (e.sizeBytes > 0)     std::cout << "  Size    : " << DownloadManager::formatBytes(e.sizeBytes) << "\n";
        if (!e.description.empty()) {
            std::string desc = e.description.substr(0, 120);
            if (e.description.size() > 120) desc += "…";
            std::cout << "  Desc    : " << desc << "\n";
        }
        std::cout << "\n";
    }
}

int main(int argc, char* argv[]) {
    if (argc < 2) { printUsage(); return 1; }

    std::vector<std::string> args(argv + 1, argv + argc);
    const std::string& cmd = args[0];

    DownloadManager dm;
    dm.setGoogleDriveApiKey(argValue(args, "--key"));

    // ------------------------------------------------------------------ //
    if (cmd == "search") {
        if (args.size() < 2) { printUsage(); return 1; }
        std::string query;
        for (size_t i = 1; i < args.size(); ++i) {
            if (!query.empty()) query += ' ';
            query += args[i];
        }
        printEntries(dm.searchInternetArchive(query));

    // ------------------------------------------------------------------ //
    } else if (cmd == "browse") {
        if (args.size() < 2) { printUsage(); return 1; }
        printEntries(dm.browseCollection(args[1]));

    // ------------------------------------------------------------------ //
    } else if (cmd == "files") {
        if (args.size() < 2) { printUsage(); return 1; }
        printEntries(dm.listItemFiles(args[1]));

    // ------------------------------------------------------------------ //
    } else if (cmd == "get") {
        if (args.size() < 3) { printUsage(); return 1; }
        std::string itemId   = args[1];
        std::string filename = args[2];
        std::string destDir  = args.size() >= 4 ? args[3] : ".";

        std::cout << "Downloading \"" << filename << "\" from " << itemId << " ...\n";

        auto result = dm.downloadFromArchive(itemId, filename, destDir,
            [](uint64_t done, uint64_t total, double speed) -> bool {
                if (total > 0) {
                    int pct = static_cast<int>(done * 100 / total);
                    std::cout << "\r  " << pct << "% — "
                              << DownloadManager::formatBytes(done) << " / "
                              << DownloadManager::formatBytes(total) << "  ("
                              << DownloadManager::formatBytes(static_cast<uint64_t>(speed)) << "/s)   "
                              << std::flush;
                }
                return true;
            });

        std::cout << "\n";
        if (result.success) {
            std::cout << "Saved to: " << result.localPath << "\n"
                      << "Size    : " << DownloadManager::formatBytes(result.bytesDownloaded) << "\n"
                      << "Time    : " << result.durationSeconds << "s\n";
        } else {
            std::cerr << "Download failed: " << result.errorMessage << "\n";
            return 1;
        }

    // ------------------------------------------------------------------ //
    } else if (cmd == "drive-list") {
        if (args.size() < 2) { printUsage(); return 1; }
        printEntries(dm.listGoogleDriveFolder(args[1]));

    // ------------------------------------------------------------------ //
    } else if (cmd == "drive-get") {
        if (args.size() < 3) { printUsage(); return 1; }
        std::string fileId   = args[1];
        std::string filename = args[2];
        std::string destDir  = ".";
        for (size_t i = 3; i < args.size(); ++i) {
            if (args[i] != "--key") { destDir = args[i]; break; }
        }

        std::cout << "Downloading \"" << filename << "\" from Google Drive ...\n";

        auto result = dm.downloadFromGoogleDrive(fileId, filename, destDir,
            [](uint64_t done, uint64_t total, double speed) -> bool {
                if (total > 0) {
                    int pct = static_cast<int>(done * 100 / total);
                    std::cout << "\r  " << pct << "% — "
                              << DownloadManager::formatBytes(done) << " / "
                              << DownloadManager::formatBytes(total) << "  ("
                              << DownloadManager::formatBytes(static_cast<uint64_t>(speed)) << "/s)   "
                              << std::flush;
                }
                return true;
            });

        std::cout << "\n";
        if (result.success) {
            std::cout << "Saved to: " << result.localPath << "\n"
                      << "Size    : " << DownloadManager::formatBytes(result.bytesDownloaded) << "\n"
                      << "Time    : " << result.durationSeconds << "s\n";
        } else {
            std::cerr << "Download failed: " << result.errorMessage << "\n";
            return 1;
        }

    } else {
        std::cerr << "Unknown command: " << cmd << "\n\n";
        printUsage();
        return 1;
    }

    return 0;
}
