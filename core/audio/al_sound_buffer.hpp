/*
 * OpenAL Sound Buffer
 * Audio data storage and format management
 */

#pragma once

#include <string>
#include <cstdint>

namespace tilt {

/**
 * Audio format information
 */
enum class AudioFormat {
    Mono8,
    Mono16,
    Stereo8,
    Stereo16
};

/**
 * Sound Buffer
 * Stores decoded audio data in OpenAL buffer
 */
class SoundBuffer {
public:
    SoundBuffer();
    ~SoundBuffer();

    // Disable copy
    SoundBuffer(const SoundBuffer&) = delete;
    SoundBuffer& operator=(const SoundBuffer&) = delete;

    /**
     * Load audio from file
     * Supports: WAV, MP3, OGG, FLAC
     */
    bool loadFromFile(const std::string& filepath);

    /**
     * Create from memory
     */
    bool createFromMemory(const int16_t* data, uint32_t sampleCount,
                          uint32_t sampleRate, AudioFormat format);

    /**
     * Get properties
     */
    uint32_t getBufferId() const { return bufferId_; }
    uint32_t getSampleRate() const { return sampleRate_; }
    uint32_t getChannelCount() const { return channels_; }
    uint32_t getBitsPerSample() const { return bitsPerSample_; }
    float getDuration() const { return duration_; }
    uint64_t getSize() const { return size_; }
    bool isValid() const { return bufferId_ != 0; }

    /**
     * Get file info
     */
    const std::string& getFilepath() const { return filepath_; }

    /**
     * Cleanup
     */
    void destroy();

private:
    uint32_t bufferId_;
    std::string filepath_;

    uint32_t sampleRate_;
    uint32_t channels_;
    uint32_t bitsPerSample_;
    float duration_;
    uint64_t size_;

    // Audio decoding helpers
    bool loadWAV(const std::string& filepath);
    bool loadMP3(const std::string& filepath);
    bool loadOGG(const std::string& filepath);
    bool loadFLAC(const std::string& filepath);

    // Determine format from extension
    std::string getFileExtension(const std::string& filepath);
    uint32_t getOpenALFormat(uint32_t channels, uint32_t bitsPerSample);
};

} // namespace tilt
