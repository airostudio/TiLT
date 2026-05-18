#include "download_manager.hpp"

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <chrono>
#include <algorithm>
#include <regex>
#include <cstdio>

namespace fs = std::filesystem;
using json   = nlohmann::json;

namespace tilt {

// ============================================================================
// CURL helpers
// ============================================================================

static size_t writeStringCb(char* ptr, size_t size, size_t nmemb, std::string* out) {
    out->append(ptr, size * nmemb);
    return size * nmemb;
}

static size_t writeFileCb(char* ptr, size_t size, size_t nmemb, std::ofstream* file) {
    file->write(ptr, static_cast<std::streamsize>(size * nmemb));
    return size * nmemb;
}

struct ProgressCtx {
    DownloadProgressCallback cb;
    std::chrono::steady_clock::time_point start;
};

static int xferInfoCb(void* clientp,
                      curl_off_t dltotal, curl_off_t dlnow,
                      curl_off_t /*ultotal*/, curl_off_t /*ulnow*/) {
    if (!clientp) return 0;
    auto* ctx = static_cast<ProgressCtx*>(clientp);
    if (!ctx->cb) return 0;

    double secs = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - ctx->start).count();
    double speed = secs > 0.0 ? static_cast<double>(dlnow) / secs : 0.0;

    bool keepGoing = ctx->cb(
        static_cast<uint64_t>(dlnow),
        static_cast<uint64_t>(dltotal),
        speed);
    return keepGoing ? 0 : 1; // non-zero = abort
}

// URL-encode a string using libcurl.
static std::string urlEncode(const std::string& s) {
    CURL* h = curl_easy_init();
    if (!h) return s;
    char* enc = curl_easy_escape(h, s.c_str(), static_cast<int>(s.size()));
    std::string result(enc ? enc : s);
    curl_free(enc);
    curl_easy_cleanup(h);
    return result;
}

// ============================================================================
// Impl (owns the global CURL init/cleanup lifetime)
// ============================================================================

struct DownloadManager::Impl {
    Impl()  { curl_global_init(CURL_GLOBAL_DEFAULT); }
    ~Impl() { curl_global_cleanup(); }
};

// ============================================================================
// DownloadManager
// ============================================================================

DownloadManager::DownloadManager()
    : m_impl(std::make_unique<Impl>()) {}

DownloadManager::~DownloadManager() = default;

void DownloadManager::setGoogleDriveApiKey(const std::string& key) { m_googleApiKey = key; }
void DownloadManager::setDownloadDirectory(const std::string& dir) { m_downloadDir = dir; }
void DownloadManager::setTimeout(int s)                            { m_timeoutSeconds = s; }
void DownloadManager::setUserAgent(const std::string& ua)          { m_userAgent = ua; }

// ------------------------------------------------------------------ utilities

std::string DownloadManager::formatBytes(uint64_t bytes) {
    static const char* units[] = {"B", "KB", "MB", "GB"};
    double val = static_cast<double>(bytes);
    int u = 0;
    while (val >= 1024.0 && u < 3) { val /= 1024.0; ++u; }
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.1f %s", val, units[u]);
    return buf;
}

std::string DownloadManager::buildArchiveDownloadUrl(const std::string& itemId,
                                                      const std::string& filename) {
    return "https://archive.org/download/" + itemId + "/" + urlEncode(filename);
}

std::string DownloadManager::buildGoogleDriveDownloadUrl(const std::string& fileId) {
    return "https://drive.google.com/uc?export=download&id=" + fileId;
}

// ------------------------------------------------------------------ httpGet

std::string DownloadManager::httpGet(const std::string& url, int* outHttpCode) {
    CURL* curl = curl_easy_init();
    if (!curl) return {};

    std::string body;
    curl_easy_setopt(curl, CURLOPT_URL,           url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeStringCb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA,     &body);
    curl_easy_setopt(curl, CURLOPT_USERAGENT,     m_userAgent.c_str());
    curl_easy_setopt(curl, CURLOPT_TIMEOUT,       static_cast<long>(m_timeoutSeconds));
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);

    curl_easy_perform(curl);

    if (outHttpCode) {
        long code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
        *outHttpCode = static_cast<int>(code);
    }

    curl_easy_cleanup(curl);
    return body;
}

// ------------------------------------------------------------------ download

DownloadResult DownloadManager::downloadToFile(const std::string& url,
                                                const std::string& destPath,
                                                DownloadProgressCallback callback) {
    DownloadResult result;
    auto startTime = std::chrono::steady_clock::now();

    CURL* curl = curl_easy_init();
    if (!curl) { result.errorMessage = "CURL init failed"; return result; }

    fs::create_directories(fs::path(destPath).parent_path());

    std::ofstream file(destPath, std::ios::binary);
    if (!file) {
        result.errorMessage = "Cannot write to: " + destPath;
        curl_easy_cleanup(curl);
        return result;
    }

    ProgressCtx ctx{callback, startTime};

    curl_easy_setopt(curl, CURLOPT_URL,            url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,  writeFileCb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA,      &file);
    curl_easy_setopt(curl, CURLOPT_USERAGENT,      m_userAgent.c_str());
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, static_cast<long>(m_timeoutSeconds));
    curl_easy_setopt(curl, CURLOPT_TIMEOUT,        0L); // no cap on transfer time
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);

    if (callback) {
        curl_easy_setopt(curl, CURLOPT_NOPROGRESS,       0L);
        curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, xferInfoCb);
        curl_easy_setopt(curl, CURLOPT_XFERINFODATA,     &ctx);
    }

    CURLcode rc = curl_easy_perform(curl);
    file.close();

    if (rc == CURLE_ABORTED_BY_CALLBACK) {
        fs::remove(destPath);
        result.errorMessage = "Cancelled by user";
        curl_easy_cleanup(curl);
        return result;
    }

    if (rc != CURLE_OK) {
        fs::remove(destPath);
        result.errorMessage = curl_easy_strerror(rc);
        curl_easy_cleanup(curl);
        return result;
    }

    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
    curl_easy_cleanup(curl);

    if (httpCode < 200 || httpCode >= 300) {
        fs::remove(destPath);
        result.errorMessage = "HTTP " + std::to_string(httpCode);
        return result;
    }

    auto elapsed = std::chrono::steady_clock::now() - startTime;
    result.success         = true;
    result.localPath       = destPath;
    result.bytesDownloaded = fs::file_size(destPath);
    result.durationSeconds = std::chrono::duration<double>(elapsed).count();
    return result;
}

// ============================================================================
// Internet Archive
// ============================================================================

SearchResult DownloadManager::searchInternetArchive(const std::string& query,
                                                     int page,
                                                     int pageSize) {
    SearchResult result;
    result.page = page;

    std::string url =
        "https://archive.org/advancedsearch.php"
        "?q="      + urlEncode(query) +
        "&fl[]=identifier&fl[]=title&fl[]=description&fl[]=subject&fl[]=item_size"
        "&rows="   + std::to_string(pageSize) +
        "&page="   + std::to_string(page) +
        "&output=json";

    int code = 0;
    std::string body = httpGet(url, &code);

    if (code != 200 || body.empty()) {
        result.errorMessage = "Archive.org search failed (HTTP " + std::to_string(code) + ")";
        return result;
    }

    try {
        auto j = json::parse(body);
        auto& resp = j["response"];
        result.totalFound = resp["numFound"].get<int>();

        for (auto& doc : resp["docs"]) {
            GameEntry e;
            e.source  = RepositoryType::InternetArchive;
            e.id      = doc.value("identifier", "");
            e.itemId  = e.id;
            e.title   = doc.value("title", e.id);
            e.description = doc.value("description", "");

            if (doc.contains("item_size") && !doc["item_size"].is_null())
                e.sizeBytes = doc["item_size"].get<uint64_t>();

            if (doc.contains("subject")) {
                auto& subj = doc["subject"];
                if (subj.is_array())
                    for (auto& s : subj) e.tags.push_back(s.get<std::string>());
                else if (subj.is_string())
                    e.tags.push_back(subj.get<std::string>());
            }

            result.entries.push_back(std::move(e));
        }

        result.hasMore  = (page * pageSize) < result.totalFound;
        result.success  = true;
    } catch (const std::exception& ex) {
        result.errorMessage = std::string("Parse error: ") + ex.what();
    }

    return result;
}

SearchResult DownloadManager::browseCollection(const std::string& collectionId,
                                                int page,
                                                int pageSize) {
    return searchInternetArchive("collection:" + collectionId, page, pageSize);
}

SearchResult DownloadManager::listItemFiles(const std::string& itemId) {
    SearchResult result;

    std::string url  = "https://archive.org/metadata/" + itemId + "/files";
    int code = 0;
    std::string body = httpGet(url, &code);

    if (code != 200 || body.empty()) {
        result.errorMessage = "Failed to list item files (HTTP " + std::to_string(code) + ")";
        return result;
    }

    static const std::vector<std::string> kGameExts{
        ".vpx", ".vpt", ".fp", ".fpt", ".zip", ".7z", ".rar", ".rom", ".bin"
    };

    try {
        auto j = json::parse(body);

        for (auto& f : j["result"]) {
            std::string name = f.value("name", "");
            if (name.empty() || name.front() == '_') continue;

            std::string lower = name;
            std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

            bool relevant = std::any_of(kGameExts.begin(), kGameExts.end(),
                [&](const std::string& ext) {
                    return lower.size() >= ext.size() &&
                           lower.compare(lower.size() - ext.size(), ext.size(), ext) == 0;
                });
            if (!relevant) continue;

            GameEntry e;
            e.source      = RepositoryType::InternetArchive;
            e.itemId      = itemId;
            e.filename    = name;
            e.id          = itemId + "/" + name;
            e.title       = name;
            e.downloadUrl = buildArchiveDownloadUrl(itemId, name);

            try { e.sizeBytes = std::stoull(f.value("size", "0")); } catch (...) {}

            result.entries.push_back(std::move(e));
        }

        result.totalFound = static_cast<int>(result.entries.size());
        result.success    = true;
    } catch (const std::exception& ex) {
        result.errorMessage = std::string("Parse error: ") + ex.what();
    }

    return result;
}

DownloadResult DownloadManager::downloadFromArchive(const std::string& itemId,
                                                     const std::string& filename,
                                                     const std::string& destDir,
                                                     DownloadProgressCallback callback) {
    std::string url  = buildArchiveDownloadUrl(itemId, filename);
    std::string dest = (fs::path(destDir) / filename).string();
    return downloadToFile(url, dest, callback);
}

// ============================================================================
// Google Drive
// ============================================================================

std::string DownloadManager::resolveGoogleDriveUrl(const std::string& fileId) {
    // With API key: stream via the Drive API (no HTML confirmation page).
    if (!m_googleApiKey.empty())
        return "https://www.googleapis.com/drive/v3/files/" +
               fileId + "?alt=media&key=" + m_googleApiKey;

    // Without API key: use the public export URL.
    // For files >~40 MB Google redirects to a confirmation page.
    // We issue a HEAD-like request, follow redirects, and extract the
    // confirm token from the final URL if present.
    std::string baseUrl = buildGoogleDriveDownloadUrl(fileId);

    CURL* curl = curl_easy_init();
    if (!curl) return baseUrl;

    char* finalUrlPtr = nullptr;
    std::string dummy;
    curl_easy_setopt(curl, CURLOPT_URL,            baseUrl.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,  writeStringCb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA,      &dummy);
    curl_easy_setopt(curl, CURLOPT_USERAGENT,      m_userAgent.c_str());
    curl_easy_setopt(curl, CURLOPT_TIMEOUT,        static_cast<long>(m_timeoutSeconds));
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_NOBODY,         1L); // headers only

    curl_easy_perform(curl);
    curl_easy_getinfo(curl, CURLINFO_EFFECTIVE_URL, &finalUrlPtr);
    std::string finalUrl(finalUrlPtr ? finalUrlPtr : "");
    curl_easy_cleanup(curl);

    // Extract confirm= token if present in the redirect URL
    std::regex confirmRe(R"([?&]confirm=([^&"]+))");
    std::smatch m;
    if (std::regex_search(finalUrl, m, confirmRe))
        return baseUrl + "&confirm=" + m[1].str();

    return baseUrl;
}

SearchResult DownloadManager::listGoogleDriveFolder(const std::string& folderId,
                                                     const std::string& pageToken) {
    SearchResult result;

    if (m_googleApiKey.empty()) {
        result.errorMessage = "Google Drive API key required — call setGoogleDriveApiKey()";
        return result;
    }

    std::string url =
        "https://www.googleapis.com/drive/v3/files"
        "?q="        + urlEncode("'" + folderId + "' in parents and trashed=false") +
        "&key="      + m_googleApiKey +
        "&fields="   + urlEncode("files(id,name,size,mimeType,modifiedTime),nextPageToken") +
        "&pageSize=100";
    if (!pageToken.empty()) url += "&pageToken=" + urlEncode(pageToken);

    int code = 0;
    std::string body = httpGet(url, &code);

    if (code != 200 || body.empty()) {
        result.errorMessage = "Google Drive API error (HTTP " + std::to_string(code) + ")";
        return result;
    }

    try {
        auto j = json::parse(body);

        if (j.contains("error")) {
            result.errorMessage = j["error"]["message"].get<std::string>();
            return result;
        }

        for (auto& f : j["files"]) {
            GameEntry e;
            e.source      = RepositoryType::GoogleDrive;
            e.id          = f.value("id", "");
            e.filename    = f.value("name", "");
            e.title       = e.filename;
            e.downloadUrl = buildGoogleDriveDownloadUrl(e.id);

            try { e.sizeBytes = std::stoull(f.value("size", "0")); } catch (...) {}

            result.entries.push_back(std::move(e));
        }

        if (j.contains("nextPageToken")) {
            result.nextPageToken = j["nextPageToken"].get<std::string>();
            result.hasMore       = true;
        }

        result.totalFound = static_cast<int>(result.entries.size());
        result.success    = true;
    } catch (const std::exception& ex) {
        result.errorMessage = std::string("Parse error: ") + ex.what();
    }

    return result;
}

DownloadResult DownloadManager::downloadFromGoogleDrive(const std::string& fileId,
                                                         const std::string& filename,
                                                         const std::string& destDir,
                                                         DownloadProgressCallback callback) {
    std::string url  = resolveGoogleDriveUrl(fileId);
    std::string name = filename.empty() ? (fileId + ".bin") : filename;
    std::string dest = (fs::path(destDir) / name).string();
    return downloadToFile(url, dest, callback);
}

} // namespace tilt
