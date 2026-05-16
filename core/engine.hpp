/*
 * TiLT Core Engine
 * Main engine class that coordinates all subsystems
 */

#ifndef TILT_CORE_ENGINE_HPP
#define TILT_CORE_ENGINE_HPP

#include <string>
#include <memory>
#include <vector>

namespace tilt {

class Config;
class ROMEmulator;
class PhysicsWorld;
class Renderer;
class AudioEngine;
class ScriptEngine;

enum class RendererType {
    Vulkan,
    OpenGL,
    DirectX12,
    Metal,
    WebGL,
};

class Engine {
public:
    Engine();
    ~Engine();

    // Configuration
    void loadConfig(const std::string& configFile);
    void loadDefaultConfig();
    void saveConfig(const std::string& configFile);

    // Renderer setup
    void setRenderer(const std::string& rendererName);
    void setRenderer(RendererType type);
    RendererType getRendererType() const { return rendererType_; }

    // VR support
    void enableVR();
    void disableVR();
    bool isVREnabled() const { return vrEnabled_; }

    // ROM emulation
    void loadROM(const std::string& romName);
    void unloadROM();
    ROMEmulator* getROMEmulator() { return romEmulator_.get(); }

    // Table management
    void loadTable(const std::string& tableFile);
    void unloadTable();
    std::string getCurrentTable() const { return currentTable_; }

    // Engine control
    void run();
    void pause();
    void resume();
    void stop();
    bool isRunning() const { return running_; }

    // Single-frame tick — used by the Emscripten main loop so the blocking
    // run() loop is never entered in the WASM build.
    void tick(float deltaTime) { update(deltaTime); }

    // Subsystem access
    PhysicsWorld* getPhysicsWorld() { return physicsWorld_.get(); }
    Renderer* getRenderer() { return renderer_.get(); }
    AudioEngine* getAudioEngine() { return audioEngine_.get(); }
    ScriptEngine* getScriptEngine() { return scriptEngine_.get(); }

    // Performance metrics
    float getFPS() const { return fps_; }
    float getPhysicsUpdateRate() const { return physicsHz_; }

private:
    void initialize();
    void shutdown();
    void update(float deltaTime);
    void render();
    void handleInput();

    // Configuration
    std::unique_ptr<Config> config_;

    // Subsystems
    std::unique_ptr<ROMEmulator> romEmulator_;
    std::unique_ptr<PhysicsWorld> physicsWorld_;
    std::unique_ptr<Renderer> renderer_;
    std::unique_ptr<AudioEngine> audioEngine_;
    std::unique_ptr<ScriptEngine> scriptEngine_;

    // State
    RendererType rendererType_;
    bool vrEnabled_;
    bool running_;
    bool paused_;
    std::string currentTable_;
    std::string currentROM_;

    // Performance
    float fps_;
    float physicsHz_;
};

} // namespace tilt

#endif // TILT_CORE_ENGINE_HPP
