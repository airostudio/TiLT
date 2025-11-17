/*
 * Import GUI Implementation
 */

#include "import_gui.hpp"
#include <iostream>
#include <algorithm>
#include <filesystem>

namespace tilt {

ImportGUI::ImportGUI()
    : visible_(false)
    , importing_(false)
    , currentProgress_(0)
    , totalProgress_(0)
    , basePath_("./data")
    , autoOrganize_(true)
    , overwriteExisting_(false)
    , createBackups_(true)
    , showPreview_(true)
{
    importManager_ = std::make_unique<ImportManager>();
    loadSettings();
    initializeUI();
}

ImportGUI::~ImportGUI() {
    saveSettings();
}

void ImportGUI::initializeUI() {
    std::cout << "[Import GUI] Initializing user interface..." << std::endl;

    // Initialize GUI framework (would use Dear ImGui, Qt, or similar)
    // For now, this is a placeholder showing the structure

    createMainWindow();
    createProgressWindow();
    createSettingsWindow();
    createPreviewWindow();
}

void ImportGUI::createMainWindow() {
    // Create main import window
    // This would create:
    // - Title: "Import Content"
    // - Drag & Drop zone
    // - File browser button
    // - Recent imports list
    // - Settings button
    // - Import button
}

void ImportGUI::createProgressWindow() {
    // Create progress window
    // - Progress bar
    // - Current file label
    // - File count (X/Y)
    // - Cancel button
    // - Details expander showing all files
}

void ImportGUI::createSettingsWindow() {
    // Create settings dialog
    // - Base path selector
    // - Auto-organize checkbox
    // - Overwrite existing checkbox
    // - Create backups checkbox
    // - Show preview checkbox
    // - Apply/Cancel buttons
}

void ImportGUI::createPreviewWindow() {
    // Create preview window
    // - List of files to be imported
    // - Destination paths
    // - File type icons
    // - File size
    // - Deselect checkbox for each file
    // - Import/Cancel buttons
}

void ImportGUI::show() {
    visible_ = true;
    std::cout << "[Import GUI] Showing import dialog" << std::endl;

    std::cout << R"(
╔══════════════════════════════════════════════════════════════╗
║                    TiLT Content Importer                     ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │                                                      │   ║
║  │         📦  Drag & Drop ZIP Files Here              │   ║
║  │                                                      │   ║
║  │              or click to browse...                   │   ║
║  │                                                      │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  Supported Files:                                            ║
║  • Table Files (.vpx, .fpt, .fp)                            ║
║  • ROM Files (.zip)                                          ║
║  • Backglasses (.directb2s, .b2s)                           ║
║  • Media (images, videos, audio)                            ║
║  • PuP Packs (.pup)                                         ║
║                                                              ║
║  [📂 Browse Files]  [📁 Browse Folder]  [⚙️  Settings]      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    )" << std::endl;
}

void ImportGUI::hide() {
    visible_ = false;
    std::cout << "[Import GUI] Hiding import dialog" << std::endl;
}

void ImportGUI::openImportDialog(ImportDialogMode mode) {
    std::cout << "[Import GUI] Opening import dialog (mode: " << static_cast<int>(mode) << ")" << std::endl;

    switch (mode) {
        case ImportDialogMode::SingleFile:
            std::cout << "[Import GUI] Select a ZIP file to import:" << std::endl;
            // Open file browser for single file selection
            break;

        case ImportDialogMode::MultipleFiles:
            std::cout << "[Import GUI] Select one or more ZIP files to import:" << std::endl;
            // Open file browser for multiple file selection
            break;

        case ImportDialogMode::Directory:
            std::cout << "[Import GUI] Select a directory containing ZIP files:" << std::endl;
            // Open directory browser
            break;

        case ImportDialogMode::DragAndDrop:
            std::cout << "[Import GUI] Drag and drop ZIP files onto the window" << std::endl;
            break;
    }
}

void ImportGUI::handleDragAndDrop(const std::vector<std::string>& paths) {
    std::cout << "[Import GUI] Handling drag & drop (" << paths.size() << " items)" << std::endl;

    // Filter for ZIP files
    std::vector<std::string> zipFiles;
    std::vector<std::string> directories;

    for (const auto& path : paths) {
        if (std::filesystem::is_directory(path)) {
            directories.push_back(path);
        } else if (std::filesystem::path(path).extension() == ".zip") {
            zipFiles.push_back(path);
        }
    }

    // Show preview if enabled
    if (showPreview_ && !zipFiles.empty()) {
        showPreview(zipFiles[0]);
    }

    // Import ZIP files
    if (!zipFiles.empty()) {
        importing_ = true;

        // Set progress callback
        importManager_->setProgressCallback(
            [this](int current, int total, const std::string& file) {
                updateProgress(current, total, file);
            }
        );

        // Start import
        importManager_->importMultipleZips(zipFiles);

        // Import directories
        for (const auto& dir : directories) {
            importManager_->importDirectory(dir);
        }

        importing_ = false;

        // Show completion dialog
        int imported = importManager_->getImportedFiles();
        int total = importManager_->getTotalFiles();
        showCompletionDialog(imported, total);
    }
}

void ImportGUI::showPreview(const std::string& zipPath) {
    std::cout << "[Import GUI] Previewing: " << zipPath << std::endl;

    std::cout << R"(
╔══════════════════════════════════════════════════════════════╗
║                    Import Preview                            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Package: )" << std::filesystem::path(zipPath).filename().string() << R"(
║                                                              ║
║  Files to be imported:                                       ║
║  ┌────────────────────────────────────────────────────────┐ ║
║  │ ✓ [TABLE] MedievalMadness.vpx → /data/tables/          │ ║
║  │ ✓ [ROM] mm_109.zip → /data/roms/                       │ ║
║  │ ✓ [B2S] MedievalMadness.directb2s → /data/backglasses/ │ ║
║  │ ✓ [IMAGE] MedievalMadness.png → /data/media/artwork/   │ ║
║  │ ✓ [VIDEO] MedievalMadness.mp4 → /data/media/videos/    │ ║
║  │ ✓ [WHEEL] MedievalMadness_wheel.png → /data/media/...  │ ║
║  └────────────────────────────────────────────────────────┘ ║
║                                                              ║
║  Total: 6 files (245 MB)                                     ║
║                                                              ║
║  [✓ Import]  [✗ Cancel]                                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    )" << std::endl;
}

void ImportGUI::updateProgress(int current, int total, const std::string& currentFile) {
    currentProgress_ = current;
    totalProgress_ = total;
    currentFile_ = currentFile;

    int percentage = (current * 100) / total;
    int barWidth = 50;
    int filled = (percentage * barWidth) / 100;

    std::cout << "\r[Import GUI] Progress: [";
    for (int i = 0; i < barWidth; i++) {
        if (i < filled) std::cout << "█";
        else std::cout << "░";
    }
    std::cout << "] " << percentage << "% (" << current << "/" << total << ") - "
              << currentFile << std::flush;
}

void ImportGUI::showCompletionDialog(int filesImported, int totalFiles) {
    std::cout << "\n\n";
    std::cout << R"(
╔══════════════════════════════════════════════════════════════╗
║                    Import Complete!                          ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║                         ✅  SUCCESS                          ║
║                                                              ║
║  )" << filesImported << " of " << totalFiles << R"( files imported successfully
║                                                              ║
║  Your content has been organized and is ready to play!       ║
║                                                              ║
║  [🎮 Launch TiLT]  [📥 Import More]  [✓ Close]              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    )" << std::endl;
}

void ImportGUI::showSettingsDialog() {
    std::cout << R"(
╔══════════════════════════════════════════════════════════════╗
║                    Import Settings                           ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Base Path:                                                  ║
║  [)" << basePath_ << R"(                          ] [Browse]  ║
║                                                              ║
║  Options:                                                    ║
║  [)" << (autoOrganize_ ? "✓" : " ") << R"(] Auto-organize files by type                        ║
║  [)" << (overwriteExisting_ ? "✓" : " ") << R"(] Overwrite existing files                        ║
║  [)" << (createBackups_ ? "✓" : " ") << R"(] Create backups before overwriting                 ║
║  [)" << (showPreview_ ? "✓" : " ") << R"(] Show preview before importing                      ║
║                                                              ║
║  [Apply]  [Cancel]  [Restore Defaults]                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    )" << std::endl;
}

void ImportGUI::loadSettings() {
    // Load settings from config file
    std::cout << "[Import GUI] Loading settings..." << std::endl;

    // This would load from an INI or JSON file
    // For now, using defaults set in constructor
}

void ImportGUI::saveSettings() {
    // Save settings to config file
    std::cout << "[Import GUI] Saving settings..." << std::endl;

    // This would save to an INI or JSON file
}

void ImportGUI::renderFileList(const std::vector<ImportedFile>& files) {
    std::cout << "╔════════════════════════════════════════════════════════════╗" << std::endl;
    std::cout << "║  Files to Import                                           ║" << std::endl;
    std::cout << "╠════════════════════════════════════════════════════════════╣" << std::endl;

    for (const auto& file : files) {
        std::string typeStr;
        switch (file.type) {
            case FileType::Table_VPX: typeStr = "TABLE"; break;
            case FileType::ROM: typeStr = "ROM  "; break;
            case FileType::Backglass_DirectB2S: typeStr = "B2S  "; break;
            case FileType::Media_Image: typeStr = "IMAGE"; break;
            case FileType::Media_Video: typeStr = "VIDEO"; break;
            case FileType::Media_Wheel: typeStr = "WHEEL"; break;
            default: typeStr = "OTHER"; break;
        }

        std::cout << "║  [" << typeStr << "] " << file.filename;

        // Pad to align
        int padding = 50 - file.filename.length();
        for (int i = 0; i < padding; i++) std::cout << " ";

        std::cout << "║" << std::endl;
    }

    std::cout << "╚════════════════════════════════════════════════════════════╝" << std::endl;
}

void ImportGUI::renderDropZone() {
    std::cout << "  ┌────────────────────────────────────────────────────────┐" << std::endl;
    std::cout << "  │                                                        │" << std::endl;
    std::cout << "  │              📦  Drop ZIP Files Here                   │" << std::endl;
    std::cout << "  │                                                        │" << std::endl;
    std::cout << "  │         Supports drag & drop from file explorer        │" << std::endl;
    std::cout << "  │                                                        │" << std::endl;
    std::cout << "  └────────────────────────────────────────────────────────┘" << std::endl;
}

void ImportGUI::renderImportButton() {
    std::cout << "  [ 📥  Import Selected Files ]" << std::endl;
}

void ImportGUI::renderSettingsPanel() {
    showSettingsDialog();
}

// Standalone function to show import dialog
void ShowImportDialog() {
    ImportGUI gui;
    gui.show();
}

// Register drag and drop handler
void RegisterDragDropHandler() {
    std::cout << "[Import GUI] Registering drag & drop handler..." << std::endl;

    // This would register with the window system to handle drag & drop events
    // Platform-specific implementation would go here
}

} // namespace tilt
