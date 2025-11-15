/*
 * TiLT Core Engine Implementation
 */

#include "engine.hpp"
#include "config.hpp"
#include "emulation/rom_emulator.hpp"
#include "physics/world.hpp"
#include "rendering/renderer.hpp"
#include "rendering/vulkan/vulkan_renderer.hpp"
#include "rendering/opengl/opengl_renderer.hpp"
#include "audio/audio_engine.hpp"
#include "scripting/script_engine.hpp"

#include <iostream>
#include <chrono>
#include <thread>

namespace tilt {

Engine::Engine()
    : rendererType_(RendererType::Vulkan)
    , vrEnabled_(false)
    , running_(false)
    , paused_(false)
    , fps_(0.0f)
    , physicsHz_(0.0f)
{
    initialize();
}

Engine::~Engine() {
    shutdown();
}

void Engine::initialize() {
    std::cout << "[Engine] Initializing subsystems..." << std::endl;

    // Create configuration
    config_ = std::make_unique<Config>();

    // Create ROM emulator (PinMAME-based)
    romEmulator_ = std::make_unique<ROMEmulator>();
    std::cout << "[Engine] ROM emulator initialized" << std::endl;

    // Create physics world (VPX-based)
    physicsWorld_ = std::make_unique<PhysicsWorld>();
    std::cout << "[Engine] Physics world initialized" << std::endl;

    // Create audio engine
    audioEngine_ = std::make_unique<AudioEngine>();
    std::cout << "[Engine] Audio engine initialized" << std::endl;

    // Create script engine
    scriptEngine_ = std::make_unique<ScriptEngine>();
    std::cout << "[Engine] Script engine initialized" << std::endl;

    std::cout << "[Engine] Initialization complete" << std::endl;
}

void Engine::shutdown() {
    std::cout << "[Engine] Shutting down..." << std::endl;

    stop();
    unloadTable();
    unloadROM();

    scriptEngine_.reset();
    audioEngine_.reset();
    renderer_.reset();
    physicsWorld_.reset();
    romEmulator_.reset();
    config_.reset();
}

void Engine::loadConfig(const std::string& configFile) {
    std::cout << "[Engine] Loading config: " << configFile << std::endl;
    config_->load(configFile);
}

void Engine::loadDefaultConfig() {
    std::cout << "[Engine] Loading default configuration" << std::endl;
    config_->loadDefaults();
}

void Engine::saveConfig(const std::string& configFile) {
    std::cout << "[Engine] Saving config: " << configFile << std::endl;
    config_->save(configFile);
}

void Engine::setRenderer(const std::string& rendererName) {
    if (rendererName == "vulkan") {
        setRenderer(RendererType::Vulkan);
    } else if (rendererName == "opengl") {
        setRenderer(RendererType::OpenGL);
    } else if (rendererName == "dx12" || rendererName == "directx12") {
        setRenderer(RendererType::DirectX12);
    } else if (rendererName == "metal") {
        setRenderer(RendererType::Metal);
    } else {
        std::cerr << "[Engine] Unknown renderer: " << rendererName << std::endl;
        std::cout << "[Engine] Falling back to Vulkan" << std::endl;
        setRenderer(RendererType::Vulkan);
    }
}

void Engine::setRenderer(RendererType type) {
    rendererType_ = type;

    // Create appropriate renderer
    switch (type) {
        case RendererType::Vulkan:
            std::cout << "[Engine] Creating Vulkan renderer" << std::endl;
            renderer_ = std::make_unique<VulkanRenderer>();
            break;
        case RendererType::OpenGL:
            std::cout << "[Engine] Creating OpenGL renderer" << std::endl;
            renderer_ = std::make_unique<OpenGLRenderer>();
            break;
        case RendererType::DirectX12:
            std::cout << "[Engine] DirectX 12 renderer not yet implemented" << std::endl;
            std::cout << "[Engine] Falling back to Vulkan" << std::endl;
            renderer_ = std::make_unique<VulkanRenderer>();
            break;
        case RendererType::Metal:
            std::cout << "[Engine] Metal renderer not yet implemented" << std::endl;
            std::cout << "[Engine] Falling back to OpenGL" << std::endl;
            renderer_ = std::make_unique<OpenGLRenderer>();
            break;
    }
}

void Engine::enableVR() {
    vrEnabled_ = true;
    std::cout << "[Engine] VR mode enabled" << std::endl;
    if (renderer_) {
        renderer_->enableVR();
    }
}

void Engine::disableVR() {
    vrEnabled_ = false;
    std::cout << "[Engine] VR mode disabled" << std::endl;
    if (renderer_) {
        renderer_->disableVR();
    }
}

void Engine::loadROM(const std::string& romName) {
    std::cout << "[Engine] Loading ROM: " << romName << std::endl;
    currentROM_ = romName;
    romEmulator_->loadROM(romName);
}

void Engine::unloadROM() {
    if (!currentROM_.empty()) {
        std::cout << "[Engine] Unloading ROM: " << currentROM_ << std::endl;
        romEmulator_->unloadROM();
        currentROM_.clear();
    }
}

void Engine::loadTable(const std::string& tableFile) {
    std::cout << "[Engine] Loading table: " << tableFile << std::endl;
    currentTable_ = tableFile;

    // Load table into physics world
    physicsWorld_->loadTable(tableFile);

    // Load table scripts
    scriptEngine_->loadTableScripts(tableFile);

    // Initialize renderer with table
    if (renderer_) {
        renderer_->loadTable(tableFile);
    }
}

void Engine::unloadTable() {
    if (!currentTable_.empty()) {
        std::cout << "[Engine] Unloading table: " << currentTable_ << std::endl;

        if (renderer_) {
            renderer_->unloadTable();
        }

        scriptEngine_->unloadTableScripts();
        physicsWorld_->unloadTable();
        currentTable_.clear();
    }
}

void Engine::run() {
    if (!renderer_) {
        std::cerr << "[Engine] No renderer initialized!" << std::endl;
        return;
    }

    running_ = true;
    paused_ = false;

    std::cout << "[Engine] Starting main loop" << std::endl;

    // Target rates
    const float targetFPS = 60.0f;
    const float targetPhysicsHz = 1000.0f;
    const float frameDuration = 1.0f / targetFPS;
    const float physicsDuration = 1.0f / targetPhysicsHz;

    auto lastFrameTime = std::chrono::high_resolution_clock::now();
    auto lastPhysicsTime = lastFrameTime;
    float physicsAccumulator = 0.0f;

    while (running_) {
        auto currentTime = std::chrono::high_resolution_clock::now();
        float deltaTime = std::chrono::duration<float>(currentTime - lastFrameTime).count();
        lastFrameTime = currentTime;

        // Handle input
        handleInput();

        if (!paused_) {
            // Accumulate physics time
            physicsAccumulator += deltaTime;

            // Update physics at fixed rate
            int physicsSteps = 0;
            while (physicsAccumulator >= physicsDuration && physicsSteps < 10) {
                physicsWorld_->update(physicsDuration);
                romEmulator_->update(physicsDuration);
                physicsAccumulator -= physicsDuration;
                physicsSteps++;
            }

            // Update other systems
            update(deltaTime);
        }

        // Render
        render();

        // Calculate FPS
        fps_ = 1.0f / deltaTime;
        physicsHz_ = 1.0f / physicsDuration;

        // Sleep to maintain target frame rate
        auto frameTime = std::chrono::high_resolution_clock::now() - currentTime;
        auto targetFrameTime = std::chrono::duration<float>(frameDuration);
        if (frameTime < targetFrameTime) {
            std::this_thread::sleep_for(targetFrameTime - frameTime);
        }
    }

    std::cout << "[Engine] Main loop ended" << std::endl;
}

void Engine::pause() {
    paused_ = true;
    std::cout << "[Engine] Paused" << std::endl;
}

void Engine::resume() {
    paused_ = false;
    std::cout << "[Engine] Resumed" << std::endl;
}

void Engine::stop() {
    running_ = false;
    std::cout << "[Engine] Stopped" << std::endl;
}

void Engine::update(float deltaTime) {
    // Update script engine
    scriptEngine_->update(deltaTime);

    // Update audio engine
    audioEngine_->update(deltaTime);
}

void Engine::render() {
    if (renderer_) {
        renderer_->beginFrame();
        renderer_->renderPlayfield(physicsWorld_.get());
        renderer_->endFrame();
    }
}

void Engine::handleInput() {
    // Input handling would go here
    // This would integrate with the input manager
}

} // namespace tilt
