/*
 * Audio Decoder
 * Multi-format audio decoding (WAV, MP3, OGG, FLAC)
 */

#pragma once

#include <string>
#include <vector>
#include <cstdint>

namespace tilt {

/**
 * Decoded audio data
 */
struct DecodedAudio {
    std::vector<int16_t> samples;
    uint32_t sampleRate;
    uint32_t channels;
    uint32_t bitsPerSample;

    DecodedAudio()
        : sampleRate(0), channels(0), bitsPerSample(16)
    {}

    uint32_t getSampleCount() const { return samples.size(); }
    uint64_t getDataSize() const { return samples.size() * sizeof(int16_t); }
    float getDuration() const {
        if (sampleRate == 0 || channels == 0) return 0.0f;
        return static_cast<float>(samples.size()) / (sampleRate * channels);
    }
};

/**
 * Audio Decoder
 * Decodes various audio formats to PCM
 */
class AudioDecoder {
public:
    AudioDecoder() = default;
    ~AudioDecoder() = default;

    /**
     * Decode audio file
     * Auto-detects format from extension
     */
    static bool decode(const std::string& filepath, DecodedAudio& output);

    /**
     * Format-specific decoders
     */
    static bool decodeWAV(const std::string& filepath, DecodedAudio& output);
    static bool decodeMP3(const std::string& filepath, DecodedAudio& output);
    static bool decodeOGG(const std::string& filepath, DecodedAudio& output);
    static bool decodeFLAC(const std::string& filepath, DecodedAudio& output);

    /**
     * Check if format is supported
     */
    static bool isFormatSupported(const std::string& extension);

    /**
     * Get supported formats
     */
    static std::vector<std::string> getSupportedFormats();

private:
    // WAV chunk reading
    struct WAVHeader {
        char riff[4];
        uint32_t fileSize;
        char wave[4];
    };

    struct WAVFormat {
        char fmt[4];
        uint32_t chunkSize;
        uint16_t audioFormat;
        uint16_t channels;
        uint32_t sampleRate;
        uint32_t byteRate;
        uint16_t blockAlign;
        uint16_t bitsPerSample;
    };

    struct WAVData {
        char data[4];
        uint32_t dataSize;
    };
};

} // namespace tilt
