/*
 * Import GUI - User-friendly import interface
 */

#ifndef TILT_IMPORT_GUI_HPP
#define TILT_IMPORT_GUI_HPP

#include "import_manager.hpp"
#include <string>
#include <vector>
#include <memory>

namespace tilt {

enum class ImportDialogMode {
    SingleFile,
    MultipleFiles,
    Directory,
    DragAndDrop
};

class ImportGUI {
public:
    ImportGUI();
    ~ImportGUI();

    // GUI operations
    void show();
    void hide();
    bool isVisible() const { return visible_; }

    // Import operations
    void openImportDialog(ImportDialogMode mode = ImportDialogMode::SingleFile);
    void handleDragAndDrop(const std::vector<std::string>& paths);
    void showPreview(const std::string& zipPath);

    // Progress display
    void updateProgress(int current, int total, const std::string& currentFile);
    void showCompletionDialog(int filesImported, int totalFiles);

    // Settings
    void showSettingsDialog();
    void loadSettings();
    void saveSettings();

private:
    void initializeUI();
    void createMainWindow();
    void createProgressWindow();
    void createSettingsWindow();
    void createPreviewWindow();

    void renderFileList(const std::vector<ImportedFile>& files);
    void renderDropZone();
    void renderImportButton();
    void renderSettingsPanel();

    std::unique_ptr<ImportManager> importManager_;
    bool visible_;
    bool importing_;
    int currentProgress_;
    int totalProgress_;
    std::string currentFile_;

    // Settings
    std::string basePath_;
    bool autoOrganize_;
    bool overwriteExisting_;
    bool createBackups_;
    bool showPreview_;
};

// Standalone import dialog function
void ShowImportDialog();

// Drag and drop handler
void RegisterDragDropHandler();

} // namespace tilt

#endif // TILT_IMPORT_GUI_HPP
