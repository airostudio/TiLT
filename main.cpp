/*
 * TiLT - Totally Integrated Luxurious Tables
 * Main entry point for the unified pinball emulator
 *
 * When compiled with Emscripten the blocking engine->run() call is replaced
 * by emscripten_set_main_loop() so control can return to the browser event
 * loop every frame.  Two C-linkage functions are exported so the JS front-end
 * can drive table loading without requiring a full page reload.
 */

#include <iostream>
#include <memory>
#include <string>

#include "core/engine.hpp"

#ifdef __EMSCRIPTEN__
#  include <emscripten.h>
#  include <emscripten/bind.h>
// The Emscripten GLFW shim and WebGL context are initialised by the engine /
// renderer subsystem; we only need the loop + exported-function machinery here.
#else
#  include "frontend/launcher.hpp"
#endif

// ── Emscripten global state ───────────────────────────────────────────────────
#ifdef __EMSCRIPTEN__
static tilt::Engine* g_engine = nullptr;

// Called by the browser ~60 times per second (requestAnimationFrame cadence).
static void mainLoopStep() {
    if (g_engine && g_engine->isRunning()) {
        g_engine->tick(1.0f / 60.0f);
    }
}

// ── Exported C functions ──────────────────────────────────────────────────────
// These are callable from JS via Module.ccall / Module.cwrap after the WASM
// module has been initialised.

extern "C" {

/**
 * Load a table from the Emscripten virtual filesystem.
 * The JS side must first write the file bytes into FS before calling this.
 *
 * @param path  Null-terminated path inside the WASM FS, e.g. "/tables/mm.vpx"
 */
EMSCRIPTEN_KEEPALIVE
void tilt_load_table_js(const char* path) {
    if (!g_engine) {
        std::cerr << "[TiLT] tilt_load_table_js called before engine was created" << std::endl;
        return;
    }
    if (!path || path[0] == '\0') {
        std::cerr << "[TiLT] tilt_load_table_js: empty path" << std::endl;
        return;
    }

    std::cout << "[TiLT] JS requested table load: " << path << std::endl;

    try {
        // Unload any currently running table first.
        if (!g_engine->getCurrentTable().empty()) {
            g_engine->unloadTable();
        }
        g_engine->loadTable(std::string(path));
        std::cout << "[TiLT] Table loaded successfully: " << path << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "[TiLT] Failed to load table '" << path << "': " << e.what() << std::endl;
    }
}

/**
 * Unload the currently running table and return to the idle state.
 * The JS front-end calls this when the user navigates back to the library.
 */
EMSCRIPTEN_KEEPALIVE
void tilt_unload_table() {
    if (!g_engine) return;

    std::cout << "[TiLT] JS requested table unload" << std::endl;

    try {
        g_engine->unloadTable();
        std::cout << "[TiLT] Table unloaded" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "[TiLT] Failed to unload table: " << e.what() << std::endl;
    }
}

} // extern "C"
#endif // __EMSCRIPTEN__

// ── Helpers (native build) ────────────────────────────────────────────────────
#ifndef __EMSCRIPTEN__
static void printBanner() {
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

static void printUsage(const char* progName) {
    std::cout << "Usage: " << progName << " [options] [table_file]\n"
              << "\nOptions:\n"
              << "  -h, --help           Show this help message\n"
              << "  -v, --version        Show version information\n"
              << "  -f, --frontend       Launch frontend browser\n"
              << "  -t, --table <file>   Load and run specific table\n"
              << "  -r, --rom <name>     Specify ROM to emulate\n"
              << "  --vr                 Enable VR mode\n"
              << "  --renderer <name>    Specify renderer (dx12, vulkan, opengl, metal)\n"
              << "  --config <file>      Load configuration file\n"
              << "  --ipc                JSON-over-stdio IPC mode (used by Electron launcher)\n"
              << "\nExamples:\n"
              << "  " << progName << " -f                    # Launch frontend\n"
              << "  " << progName << " -t table.vpx -r tz_94h  # Run specific table with ROM\n"
              << "  " << progName << " --vr -t table.vpx     # Run in VR mode\n";
}

// Emit a single-line JSON message to stdout for the Electron parent process.
static void ipcSend(const std::string& json) {
    std::cout << json << "\n";
    std::cout.flush();
}
#endif // !__EMSCRIPTEN__

// ── main() ────────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {

#ifdef __EMSCRIPTEN__
    // ── Web / WASM entry point ─────────────────────────────────────────────
    // In the WASM build argument parsing is skipped — the JS front-end drives
    // the engine via the exported C functions above.  The renderer defaults to
    // the WebGL backend selected automatically by the engine when running under
    // Emscripten.

    std::cout << "[TiLT] Web build starting (Emscripten)" << std::endl;

    try {
        g_engine = new tilt::Engine();
        g_engine->loadDefaultConfig();
        g_engine->setRenderer("webgl");

        std::cout << "[TiLT] Engine initialised — handing control to browser main loop" << std::endl;

        // 0 = use requestAnimationFrame (≈60 fps); 1 = simulate_infinite_loop
        // so main() never returns (required for Asyncify correctness).
        emscripten_set_main_loop(mainLoopStep, 0, 1);

        // emscripten_set_main_loop with simulate_infinite_loop=1 never returns.
        // The delete below is unreachable but documents intent.
        delete g_engine;
        g_engine = nullptr;
    } catch (const std::exception& e) {
        std::cerr << "[TiLT] Fatal error during WASM init: " << e.what() << std::endl;
        return 1;
    }

    return 0;

#else
    // ── Native desktop entry point ─────────────────────────────────────────
    bool launchFrontend = false;
    bool vrMode         = false;
    bool ipcMode        = false;
    std::string tableFile;
    std::string romName;
    std::string renderer  = "vulkan";
    std::string configFile;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "-h" || arg == "--help") {
            printUsage(argv[0]);
            return 0;
        } else if (arg == "-v" || arg == "--version") {
            std::cout << "TiLT version 1.0.0" << std::endl;
            return 0;
        } else if (arg == "-f" || arg == "--frontend") {
            launchFrontend = true;
        } else if (arg == "--vr") {
            vrMode = true;
        } else if (arg == "--ipc") {
            ipcMode = true;
        } else if ((arg == "-t" || arg == "--table") && i + 1 < argc) {
            tableFile = argv[++i];
        } else if ((arg == "-r" || arg == "--rom") && i + 1 < argc) {
            romName = argv[++i];
        } else if (arg == "--renderer" && i + 1 < argc) {
            renderer = argv[++i];
        } else if (arg == "--config" && i + 1 < argc) {
            configFile = argv[++i];
        }
    }

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

            if (ipcMode) {
                ipcSend(R"({"status":"ready","message":"Engine running"})");
            }

            engine->run();

            if (ipcMode) {
                ipcSend(R"({"status":"stopped","message":"Table exited"})");
            }
        } else if (launchFrontend) {
            if (!ipcMode) std::cout << "Launching frontend..." << std::endl;
            auto launcher = std::make_unique<tilt::Launcher>(engine.get());
            launcher->run();
        } else if (!ipcMode) {
            std::cout << "No options specified. Launching frontend..." << std::endl;
            auto launcher = std::make_unique<tilt::Launcher>(engine.get());
            launcher->run();
        }

        if (!ipcMode) std::cout << "Shutting down..." << std::endl;
        return 0;

    } catch (const std::exception& e) {
        if (ipcMode) {
            ipcSend(std::string(R"({"status":"error","message":")") + e.what() + "\"}");
        } else {
            std::cerr << "Fatal error: " << e.what() << std::endl;
        }
        return 1;
    }
#endif // __EMSCRIPTEN__
}
