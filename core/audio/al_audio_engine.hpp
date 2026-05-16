/*
 * OpenAL Audio Engine
 * Production-quality 3D audio system with multi-format support
 */

#pragma once

#include <string>
#include <vector>
#include <memory>
#include <unordered_map>
#include <cstdint>
#include <glm/glm.hpp>

// Use the real OpenAL ALC types. We include the header rather than forward-
// declaring because different OpenAL implementations (system OpenAL 1.23 vs
// Emscripten's OpenAL port) disagree on the underlying struct tag name.
#include <AL/alc.h>

namespace tilt {

// Forward declarations
class SoundBuffer;
class SoundSource;
class AudioDecoder;

/**
 * Audio device information
 */
struct AudioDeviceInfo {
    std::string name;
    bool isDefault;
    int maxSources;
    std::vector<int> supportedFrequencies;
};

/**
 * Audio listener (camera/player position)
 */
struct AudioListener {
    glm::vec3 position;
    glm::vec3 velocity;
    glm::vec3 forward;
    glm::vec3 up;
    float gain;

    AudioListener()
        : position(0.0f)
        , velocity(0.0f)
        , forward(0.0f, 0.0f, -1.0f)
        , up(0.0f, 1.0f, 0.0f)
        , gain(1.0f)
    {}
};

/**
 * Audio statistics
 */
struct AudioStats {
    uint32_t activeSources;
    uint32_t totalSources;
    uint32_t loadedBuffers;
    uint64_t totalMemoryUsed;
    float cpuUsage;
};

/**
 * OpenAL Audio Engine
 * Manages OpenAL context, sound buffers, and 3D audio
 */
class AudioEngine {
public:
    AudioEngine();
    ~AudioEngine();

    // Disable copy
    AudioEngine(const AudioEngine&) = delete;
    AudioEngine& operator=(const AudioEngine&) = delete;

    /**
     * Initialize audio engine
     * @param deviceName Optional device name (nullptr for default)
     */
    bool initialize(const char* deviceName = nullptr);

    /**
     * Shutdown audio engine
     */
    void shutdown();

    /**
     * Update audio engine (call per frame)
     */
    void update(float deltaTime);

    /**
     * Get available audio devices
     */
    static std::vector<AudioDeviceInfo> getAvailableDevices();

    /**
     * Check if initialized
     */
    bool isInitialized() const { return initialized_; }

    /**
     * Listener control
     */
    void setListenerPosition(const glm::vec3& position);
    void setListenerVelocity(const glm::vec3& velocity);
    void setListenerOrientation(const glm::vec3& forward, const glm::vec3& up);
    void setListenerGain(float gain);
    const AudioListener& getListener() const { return listener_; }

    /**
     * Global audio settings
     */
    void setMasterVolume(float volume);
    float getMasterVolume() const { return masterVolume_; }

    void setDopplerFactor(float factor);
    float getDopplerFactor() const;

    void setSpeedOfSound(float speed);
    float getSpeedOfSound() const;

    /**
     * Sound buffer management
     */
    SoundBuffer* loadSound(const std::string& name, const std::string& filepath);
    SoundBuffer* getSound(const std::string& name);
    void unloadSound(const std::string& name);
    void unloadAllSounds();

    /**
     * Sound source management
     */
    SoundSource* createSource(const std::string& soundName);
    SoundSource* createSource(SoundBuffer* buffer);
    void destroySource(SoundSource* source);
    void stopAllSources();

    /**
     * Quick play functions (fire and forget)
     */
    void playSound(const std::string& soundName, float volume = 1.0f);
    void playSound3D(const std::string& soundName, const glm::vec3& position, float volume = 1.0f);

    /**
     * Statistics
     */
    AudioStats getStats() const;

    /**
     * Get OpenAL context (for advanced usage)
     */
    ALCcontext* getContext() const { return context_; }

private:
    bool initialized_;
    ALCdevice* device_;
    ALCcontext* context_;

    AudioListener listener_;
    float masterVolume_;

    // Sound buffer cache
    std::unordered_map<std::string, std::unique_ptr<SoundBuffer>> soundBuffers_;

    // Active sound sources
    std::vector<std::unique_ptr<SoundSource>> sources_;

    // One-shot sources (auto-cleanup)
    std::vector<std::unique_ptr<SoundSource>> oneShotSources_;

    // Audio decoders
    std::unique_ptr<AudioDecoder> decoder_;

    // Update listener state in OpenAL
    void updateListener();

    // Cleanup finished one-shot sources
    void cleanupOneShotSources();

    // Error checking
    bool checkALError(const char* operation);
    bool checkALCError(const char* operation);
};

} // namespace tilt
