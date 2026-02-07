/*
 * OpenAL Audio Engine Implementation
 */

#include "al_audio_engine.hpp"
#include "al_sound_buffer.hpp"
#include "al_sound_source.hpp"
#include "audio_decoder.hpp"
#include <AL/al.h>
#include <AL/alc.h>
#include <iostream>
#include <algorithm>

namespace tilt {

AudioEngine::AudioEngine()
    : initialized_(false)
    , device_(nullptr)
    , context_(nullptr)
    , masterVolume_(1.0f)
{
}

AudioEngine::~AudioEngine() {
    shutdown();
}

bool AudioEngine::initialize(const char* deviceName) {
    if (initialized_) {
        std::cerr << "[AudioEngine] Already initialized" << std::endl;
        return false;
    }

    std::cout << "[AudioEngine] Initializing OpenAL..." << std::endl;

    // Open audio device
    device_ = alcOpenDevice(deviceName);
    if (!device_) {
        std::cerr << "[AudioEngine] Failed to open audio device" << std::endl;
        return false;
    }

    // Get device name
    const ALCchar* actualDeviceName = alcGetString(device_, ALC_DEVICE_SPECIFIER);
    std::cout << "[AudioEngine] Audio device: " << actualDeviceName << std::endl;

    // Create context
    context_ = alcCreateContext(device_, nullptr);
    if (!context_) {
        std::cerr << "[AudioEngine] Failed to create OpenAL context" << std::endl;
        alcCloseDevice(device_);
        device_ = nullptr;
        return false;
    }

    // Make context current
    if (!alcMakeContextCurrent(context_)) {
        std::cerr << "[AudioEngine] Failed to make context current" << std::endl;
        alcDestroyContext(context_);
        alcCloseDevice(device_);
        context_ = nullptr;
        device_ = nullptr;
        return false;
    }

    // Print OpenAL info
    std::cout << "[AudioEngine] OpenAL Vendor: " << alGetString(AL_VENDOR) << std::endl;
    std::cout << "[AudioEngine] OpenAL Version: " << alGetString(AL_VERSION) << std::endl;
    std::cout << "[AudioEngine] OpenAL Renderer: " << alGetString(AL_RENDERER) << std::endl;

    // Get extensions
    const ALchar* extensions = alGetString(AL_EXTENSIONS);
    if (extensions) {
        std::cout << "[AudioEngine] OpenAL Extensions: " << extensions << std::endl;
    }

    // Set default listener properties
    updateListener();

    // Set distance model
    alDistanceModel(AL_INVERSE_DISTANCE_CLAMPED);

    // Create audio decoder
    decoder_ = std::make_unique<AudioDecoder>();

    initialized_ = true;
    std::cout << "[AudioEngine] OpenAL initialized successfully" << std::endl;

    return true;
}

void AudioEngine::shutdown() {
    if (!initialized_) {
        return;
    }

    std::cout << "[AudioEngine] Shutting down..." << std::endl;

    // Stop all sources
    stopAllSources();

    // Cleanup one-shot sources
    oneShotSources_.clear();

    // Cleanup sources
    sources_.clear();

    // Cleanup sound buffers
    soundBuffers_.clear();

    // Cleanup decoder
    decoder_.reset();

    // Destroy context
    if (context_) {
        alcMakeContextCurrent(nullptr);
        alcDestroyContext(context_);
        context_ = nullptr;
    }

    // Close device
    if (device_) {
        alcCloseDevice(device_);
        device_ = nullptr;
    }

    initialized_ = false;
    std::cout << "[AudioEngine] Shutdown complete" << std::endl;
}

void AudioEngine::update(float deltaTime) {
    if (!initialized_) return;

    // Cleanup finished one-shot sources
    cleanupOneShotSources();

    // Check for OpenAL errors
    checkALError("update");
}

std::vector<AudioDeviceInfo> AudioEngine::getAvailableDevices() {
    std::vector<AudioDeviceInfo> devices;

    // Get default device
    const ALCchar* defaultDevice = alcGetString(nullptr, ALC_DEFAULT_DEVICE_SPECIFIER);

    // Get list of devices
    const ALCchar* deviceList = alcGetString(nullptr, ALC_DEVICE_SPECIFIER);

    if (deviceList) {
        const ALCchar* current = deviceList;
        while (*current) {
            AudioDeviceInfo info;
            info.name = current;
            info.isDefault = (info.name == defaultDevice);

            devices.push_back(info);

            // Move to next device
            current += info.name.length() + 1;
        }
    }

    return devices;
}

void AudioEngine::setListenerPosition(const glm::vec3& position) {
    listener_.position = position;
    alListener3f(AL_POSITION, position.x, position.y, position.z);
}

void AudioEngine::setListenerVelocity(const glm::vec3& velocity) {
    listener_.velocity = velocity;
    alListener3f(AL_VELOCITY, velocity.x, velocity.y, velocity.z);
}

void AudioEngine::setListenerOrientation(const glm::vec3& forward, const glm::vec3& up) {
    listener_.forward = forward;
    listener_.up = up;

    float orientation[6] = {
        forward.x, forward.y, forward.z,
        up.x, up.y, up.z
    };
    alListenerfv(AL_ORIENTATION, orientation);
}

void AudioEngine::setListenerGain(float gain) {
    listener_.gain = gain;
    alListenerf(AL_GAIN, gain * masterVolume_);
}

void AudioEngine::setMasterVolume(float volume) {
    masterVolume_ = volume;
    alListenerf(AL_GAIN, listener_.gain * masterVolume_);
}

void AudioEngine::setDopplerFactor(float factor) {
    alDopplerFactor(factor);
}

float AudioEngine::getDopplerFactor() const {
    float factor;
    alGetFloatv(AL_DOPPLER_FACTOR, &factor);
    return factor;
}

void AudioEngine::setSpeedOfSound(float speed) {
    alSpeedOfSound(speed);
}

float AudioEngine::getSpeedOfSound() const {
    float speed;
    alGetFloatv(AL_SPEED_OF_SOUND, &speed);
    return speed;
}

SoundBuffer* AudioEngine::loadSound(const std::string& name, const std::string& filepath) {
    // Check if already loaded
    auto it = soundBuffers_.find(name);
    if (it != soundBuffers_.end()) {
        std::cout << "[AudioEngine] Sound already loaded: " << name << std::endl;
        return it->second.get();
    }

    // Create and load buffer
    auto buffer = std::make_unique<SoundBuffer>();
    if (!buffer->loadFromFile(filepath)) {
        return nullptr;
    }

    SoundBuffer* ptr = buffer.get();
    soundBuffers_[name] = std::move(buffer);

    std::cout << "[AudioEngine] Loaded sound: " << name << std::endl;
    return ptr;
}

SoundBuffer* AudioEngine::getSound(const std::string& name) {
    auto it = soundBuffers_.find(name);
    if (it != soundBuffers_.end()) {
        return it->second.get();
    }
    return nullptr;
}

void AudioEngine::unloadSound(const std::string& name) {
    soundBuffers_.erase(name);
}

void AudioEngine::unloadAllSounds() {
    soundBuffers_.clear();
}

SoundSource* AudioEngine::createSource(const std::string& soundName) {
    SoundBuffer* buffer = getSound(soundName);
    if (!buffer) {
        std::cerr << "[AudioEngine] Sound not found: " << soundName << std::endl;
        return nullptr;
    }

    return createSource(buffer);
}

SoundSource* AudioEngine::createSource(SoundBuffer* buffer) {
    auto source = std::make_unique<SoundSource>();
    if (!source->isValid()) {
        return nullptr;
    }

    source->setBuffer(buffer);

    SoundSource* ptr = source.get();
    sources_.push_back(std::move(source));

    return ptr;
}

void AudioEngine::destroySource(SoundSource* source) {
    sources_.erase(
        std::remove_if(sources_.begin(), sources_.end(),
            [source](const std::unique_ptr<SoundSource>& s) {
                return s.get() == source;
            }),
        sources_.end()
    );
}

void AudioEngine::stopAllSources() {
    for (auto& source : sources_) {
        source->stop();
    }

    for (auto& source : oneShotSources_) {
        source->stop();
    }
}

void AudioEngine::playSound(const std::string& soundName, float volume) {
    SoundBuffer* buffer = getSound(soundName);
    if (!buffer) {
        std::cerr << "[AudioEngine] Sound not found: " << soundName << std::endl;
        return;
    }

    // Create one-shot source
    auto source = std::make_unique<SoundSource>();
    source->setBuffer(buffer);
    source->setVolume(volume);
    source->play();

    oneShotSources_.push_back(std::move(source));
}

void AudioEngine::playSound3D(const std::string& soundName, const glm::vec3& position, float volume) {
    SoundBuffer* buffer = getSound(soundName);
    if (!buffer) {
        std::cerr << "[AudioEngine] Sound not found: " << soundName << std::endl;
        return;
    }

    // Create one-shot 3D source
    auto source = std::make_unique<SoundSource>();
    source->setBuffer(buffer);
    source->setPosition(position);
    source->setVolume(volume);
    source->setRelativeToListener(false);
    source->play();

    oneShotSources_.push_back(std::move(source));
}

AudioStats AudioEngine::getStats() const {
    AudioStats stats;
    stats.totalSources = sources_.size() + oneShotSources_.size();
    stats.activeSources = 0;
    stats.loadedBuffers = soundBuffers_.size();
    stats.totalMemoryUsed = 0;
    stats.cpuUsage = 0.0f;

    // Count active sources
    for (const auto& source : sources_) {
        if (source->isPlaying()) {
            stats.activeSources++;
        }
    }

    for (const auto& source : oneShotSources_) {
        if (source->isPlaying()) {
            stats.activeSources++;
        }
    }

    // Calculate memory usage
    for (const auto& pair : soundBuffers_) {
        stats.totalMemoryUsed += pair.second->getSize();
    }

    return stats;
}

void AudioEngine::updateListener() {
    alListener3f(AL_POSITION, listener_.position.x, listener_.position.y, listener_.position.z);
    alListener3f(AL_VELOCITY, listener_.velocity.x, listener_.velocity.y, listener_.velocity.z);

    float orientation[6] = {
        listener_.forward.x, listener_.forward.y, listener_.forward.z,
        listener_.up.x, listener_.up.y, listener_.up.z
    };
    alListenerfv(AL_ORIENTATION, orientation);
    alListenerf(AL_GAIN, listener_.gain * masterVolume_);
}

void AudioEngine::cleanupOneShotSources() {
    oneShotSources_.erase(
        std::remove_if(oneShotSources_.begin(), oneShotSources_.end(),
            [](const std::unique_ptr<SoundSource>& source) {
                return source->isStopped();
            }),
        oneShotSources_.end()
    );
}

bool AudioEngine::checkALError(const char* operation) {
    ALenum error = alGetError();
    if (error != AL_NO_ERROR) {
        std::cerr << "[AudioEngine] OpenAL error in " << operation << ": ";
        switch (error) {
            case AL_INVALID_NAME:
                std::cerr << "AL_INVALID_NAME";
                break;
            case AL_INVALID_ENUM:
                std::cerr << "AL_INVALID_ENUM";
                break;
            case AL_INVALID_VALUE:
                std::cerr << "AL_INVALID_VALUE";
                break;
            case AL_INVALID_OPERATION:
                std::cerr << "AL_INVALID_OPERATION";
                break;
            case AL_OUT_OF_MEMORY:
                std::cerr << "AL_OUT_OF_MEMORY";
                break;
            default:
                std::cerr << "Unknown error";
        }
        std::cerr << std::endl;
        return false;
    }
    return true;
}

bool AudioEngine::checkALCError(const char* operation) {
    ALCenum error = alcGetError(device_);
    if (error != ALC_NO_ERROR) {
        std::cerr << "[AudioEngine] OpenAL context error in " << operation << ": ";
        switch (error) {
            case ALC_INVALID_DEVICE:
                std::cerr << "ALC_INVALID_DEVICE";
                break;
            case ALC_INVALID_CONTEXT:
                std::cerr << "ALC_INVALID_CONTEXT";
                break;
            case ALC_INVALID_ENUM:
                std::cerr << "ALC_INVALID_ENUM";
                break;
            case ALC_INVALID_VALUE:
                std::cerr << "ALC_INVALID_VALUE";
                break;
            case ALC_OUT_OF_MEMORY:
                std::cerr << "ALC_OUT_OF_MEMORY";
                break;
            default:
                std::cerr << "Unknown error";
        }
        std::cerr << std::endl;
        return false;
    }
    return true;
}

} // namespace tilt
