/*
 * TiLT - Totally Integrated Luxurious Tables
 * Main entry point for the unified pinball emulator
 */

#include <iostream>
#include <memory>
#include <string>
#include "core/engine.hpp"
#include "frontend/launcher.hpp"

void printBanner() {
    std::cout << R"(
  _____ _ _   _____
 |_   _(_) | |_   _|
   | | | | |   | |
   | | | | |___| |
   |_| |_|_____|_|

 Totally Integrated Luxurious Tables
 Version 1.0.0
 Combining the best of PinMAME, VPX, B2S, and PinUP Popper
    )" << std::endl;
}

void printUsage(const char* progName) {
    std::cout << "Usage: " << progName << " [options] [table_file]" << std::endl;
    std::cout << "\nOptions:" << std::endl;
    std::cout << "  -h, --help           Show this help message" << std::endl;
    std::cout << "  -v, --version        Show version information" << std::endl;
    std::cout << "  -f, --frontend       Launch frontend browser" << std::endl;
    std::cout << "  -t, --table <file>   Load and run specific table" << std::endl;
    std::cout << "  -r, --rom <name>     Specify ROM to emulate" << std::endl;
    std::cout << "  --vr                 Enable VR mode" << std::endl;
    std::cout << "  --renderer <name>    Specify renderer (dx12, vulkan, opengl, metal)" << std::endl;
    std::cout << "  --config <file>      Load configuration file" << std::endl;
    std::cout << "  --ipc                JSON-over-stdio IPC mode (used by Electron launcher)" << std::endl;
    std::cout << "\nExamples:" << std::endl;
    std::cout << "  " << progName << " -f                    # Launch frontend" << std::endl;
    std::cout << "  " << progName << " -t table.vpx -r tz_94h  # Run specific table with ROM" << std::endl;
    std::cout << "  " << progName << " --vr -t table.vpx     # Run in VR mode" << std::endl;
}

// Emit a single-line JSON message to stdout for the Electron parent process.
static void ipcSend(const std::string& json) {
    std::cout << json << "\n";
    std::cout.flush();
}

int main(int argc, char* argv[]) {
    // Parse command line arguments
    bool launchFrontend = false;
    bool vrMode = false;
    bool ipcMode = false;
    std::string tableFile;
    std::string romName;
    std::string renderer = "vulkan"; // Default renderer
    std::string configFile;

    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];

        if (arg == "-h" || arg == "--help") {
            printUsage(argv[0]);
            return 0;
        }
        else if (arg == "-v" || arg == "--version") {
            std::cout << "TiLT version 1.0.0" << std::endl;
            return 0;
        }
        else if (arg == "-f" || arg == "--frontend") {
            launchFrontend = true;
        }
        else if (arg == "--vr") {
            vrMode = true;
        }
        else if (arg == "--ipc") {
            ipcMode = true;
        }
        else if (arg == "-t" || arg == "--table") {
            if (i + 1 < argc) {
                tableFile = argv[++i];
            }
        }
        else if (arg == "-r" || arg == "--rom") {
            if (i + 1 < argc) {
                romName = argv[++i];
            }
        }
        else if (arg == "--renderer") {
            if (i + 1 < argc) {
                renderer = argv[++i];
            }
        }
        else if (arg == "--config") {
            if (i + 1 < argc) {
                configFile = argv[++i];
            }
        }
    }

    // In IPC mode suppress the banner so only JSON goes to stdout.
    if (!ipcMode) {
        printBanner();
    }

    try {
        if (ipcMode) {
            ipcSend(R"({"status":"init","message":"Initializing TiLT engine"})");
        } else {
            std::cout << "Initializing TiLT engine..." << std::endl;
        }

        auto engine = std::make_unique<tilt::Engine>();

        if (!configFile.empty()) {
            engine->loadConfig(configFile);
        } else {
            engine->loadDefaultConfig();
        }

        engine->setRenderer(renderer);

        if (vrMode) {
            if (!ipcMode) std::cout << "Enabling VR mode..." << std::endl;
            engine->enableVR();
        }

        if (!tableFile.empty()) {
            if (ipcMode) {
                ipcSend(R"({"status":"loading","message":"Loading table"})");
            } else {
                std::cout << "Loading table: " << tableFile << std::endl;
            }

            if (!romName.empty()) {
                if (!ipcMode) std::cout << "Loading ROM: " << romName << std::endl;
                engine->loadROM(romName);
            }

            engine->loadTable(tableFile);

            // Signal to Electron that the engine is ready (table window is up).
            if (ipcMode) {
                ipcSend(R"({"status":"ready","message":"Engine running"})");
            }

            engine->run();

            if (ipcMode) {
                ipcSend(R"({"status":"stopped","message":"Table exited"})");
            }
        }
        else if (launchFrontend) {
            if (!ipcMode) std::cout << "Launching frontend..." << std::endl;
            auto launcher = std::make_unique<tilt::Launcher>(engine.get());
            launcher->run();
        }
        else if (!ipcMode) {
            std::cout << "No options specified. Launching frontend..." << std::endl;
            auto launcher = std::make_unique<tilt::Launcher>(engine.get());
            launcher->run();
        }

        if (!ipcMode) std::cout << "Shutting down..." << std::endl;
        return 0;
    }
    catch (const std::exception& e) {
        if (ipcMode) {
            ipcSend(std::string(R"({"status":"error","message":")") + e.what() + "\"}");
        } else {
            std::cerr << "Fatal error: " << e.what() << std::endl;
        }
        return 1;
    }
}
