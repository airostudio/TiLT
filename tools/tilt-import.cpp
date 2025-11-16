/*
 * TiLT Import Tool - Command-line ZIP importer
 */

#include "import_manager.hpp"
#include "import_gui.hpp"
#include <iostream>
#include <vector>
#include <string>

void printBanner() {
    std::cout << R"(
  _____ _ _   _____    ___                            _
 |_   _(_) | |_   _|  |_ _|_ __ ___  _ __   ___  _ __| |_ ___ _ __
   | | | | |   | |     | || '_ ` _ \| '_ \ / _ \| '__| __/ _ \ '__|
   | | | | |___| |     | || | | | | | |_) | (_) | |  | ||  __/ |
   |_| |_|_____|_|    |___|_| |_| |_| .__/ \___/|_|   \__\___|_|
                                    |_|

 Intelligent ZIP File Import System
 Version 1.0.0
    )" << std::endl;
}

void printUsage(const char* progName) {
    std::cout << "Usage: " << progName << " [options] <files...>" << std::endl;
    std::cout << "\nOptions:" << std::endl;
    std::cout << "  -h, --help              Show this help message" << std::endl;
    std::cout << "  -g, --gui               Show graphical import interface" << std::endl;
    std::cout << "  -d, --dir <directory>   Import all ZIP files from directory" << std::endl;
    std::cout << "  -p, --preview           Preview contents before importing" << std::endl;
    std::cout << "  -b, --base-path <path>  Set base import path (default: ./data)" << std::endl;
    std::cout << "  -y, --yes               Auto-confirm all prompts" << std::endl;
    std::cout << "  -n, --no-backup         Don't create backups of existing files" << std::endl;
    std::cout << "  -o, --overwrite         Overwrite existing files without asking" << std::endl;
    std::cout << "  -v, --verbose           Verbose output" << std::endl;
    std::cout << "\nExamples:" << std::endl;
    std::cout << "  " << progName << " table.zip                    # Import single ZIP file" << std::endl;
    std::cout << "  " << progName << " *.zip                        # Import multiple ZIP files" << std::endl;
    std::cout << "  " << progName << " -d ~/Downloads               # Import from directory" << std::endl;
    std::cout << "  " << progName << " -g                           # Launch GUI importer" << std::endl;
    std::cout << "  " << progName << " -p table.zip                 # Preview before import" << std::endl;
    std::cout << "\nSupported Content:" << std::endl;
    std::cout << "  • Table Files (.vpx, .fpt, .fp)" << std::endl;
    std::cout << "  • ROM Files (.zip)" << std::endl;
    std::cout << "  • Backglass Files (.directb2s, .b2s)" << std::endl;
    std::cout << "  • Media Files (images, videos, audio)" << std::endl;
    std::cout << "  • PuP Packs (.pup)" << std::endl;
    std::cout << "  • Configuration Files (.ini, .cfg)" << std::endl;
}

int main(int argc, char* argv[]) {
    printBanner();

    if (argc < 2) {
        printUsage(argv[0]);
        return 1;
    }

    // Parse command line arguments
    bool showGUI = false;
    bool showPreview = false;
    bool autoConfirm = false;
    bool noBackup = false;
    bool overwrite = false;
    bool verbose = false;
    std::string basePath = "./data";
    std::string directory;
    std::vector<std::string> files;

    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];

        if (arg == "-h" || arg == "--help") {
            printUsage(argv[0]);
            return 0;
        }
        else if (arg == "-g" || arg == "--gui") {
            showGUI = true;
        }
        else if (arg == "-d" || arg == "--dir") {
            if (i + 1 < argc) {
                directory = argv[++i];
            }
        }
        else if (arg == "-p" || arg == "--preview") {
            showPreview = true;
        }
        else if (arg == "-b" || arg == "--base-path") {
            if (i + 1 < argc) {
                basePath = argv[++i];
            }
        }
        else if (arg == "-y" || arg == "--yes") {
            autoConfirm = true;
        }
        else if (arg == "-n" || arg == "--no-backup") {
            noBackup = true;
        }
        else if (arg == "-o" || arg == "--overwrite") {
            overwrite = true;
        }
        else if (arg == "-v" || arg == "--verbose") {
            verbose = true;
        }
        else {
            // Assume it's a file path
            files.push_back(arg);
        }
    }

    try {
        if (showGUI) {
            // Launch GUI
            std::cout << "Launching graphical import interface..." << std::endl;
            tilt::ShowImportDialog();
            return 0;
        }

        // Create import manager
        tilt::ImportManager importer;
        importer.setBasePath(basePath);
        importer.setCreateBackups(!noBackup);
        importer.setOverwriteExisting(overwrite);

        // Set progress callback
        importer.setProgressCallback([](int current, int total, const std::string& file) {
            int percentage = (current * 100) / total;
            int barWidth = 40;
            int filled = (percentage * barWidth) / 100;

            std::cout << "\r  Progress: [";
            for (int i = 0; i < barWidth; i++) {
                if (i < filled) std::cout << "█";
                else std::cout << "░";
            }
            std::cout << "] " << percentage << "% (" << current << "/" << total << ") "
                      << std::flush;
        });

        // Import directory if specified
        if (!directory.empty()) {
            std::cout << "\nImporting all ZIP files from: " << directory << std::endl;
            importer.importDirectory(directory);
        }

        // Import individual files
        if (!files.empty()) {
            std::cout << "\nImporting " << files.size() << " file(s)..." << std::endl;

            for (const auto& file : files) {
                std::cout << "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" << std::endl;
                std::cout << "Importing: " << file << std::endl;
                std::cout << "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" << std::endl;

                // Preview if requested
                if (showPreview) {
                    auto contents = importer.previewZipContents(file);
                    std::cout << "\nPreview of contents:" << std::endl;
                    for (const auto& item : contents) {
                        std::cout << "  • " << item << std::endl;
                    }

                    if (!autoConfirm) {
                        std::cout << "\nProceed with import? (y/n): ";
                        char response;
                        std::cin >> response;
                        if (response != 'y' && response != 'Y') {
                            std::cout << "Skipped." << std::endl;
                            continue;
                        }
                    }
                }

                // Import the file
                importer.importZipFile(file);
            }

            std::cout << "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" << std::endl;
            std::cout << "✅  Import Complete!" << std::endl;
            std::cout << "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" << std::endl;
            std::cout << "\nTotal files imported: " << importer.getImportedFiles() << std::endl;
            std::cout << "Files are organized in: " << basePath << std::endl;
            std::cout << "\nYou can now launch TiLT to play your tables!" << std::endl;
        }

        return 0;
    }
    catch (const std::exception& e) {
        std::cerr << "\n❌ Error: " << e.what() << std::endl;
        return 1;
    }
}
