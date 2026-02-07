/*
 * OpenAL Sound Buffer Implementation
 */

#include "al_sound_buffer.hpp"
#include "audio_decoder.hpp"
#include <AL/al.h>
#include <iostream>
#include <algorithm>

namespace tilt {

SoundBuffer::SoundBuffer()
    : bufferId_(0)
    , sampleRate_(0)
    , channels_(0)
    , bitsPerSample_(0)
    , duration_(0.0f)
    , size_(0)
{
}

SoundBuffer::~SoundBuffer() {
    destroy();
}

bool SoundBuffer::loadFromFile(const std::string& filepath) {
    filepath_ = filepath;

    // Decode audio file
    DecodedAudio decoded;
    if (!AudioDecoder::decode(filepath, decoded)) {
        return false;
    }

    // Create from decoded data
    return createFromMemory(decoded.samples.data(), decoded.getSampleCount(),
                           decoded.sampleRate,
                           decoded.channels == 1 ? AudioFormat::Mono16 : AudioFormat::Stereo16);
}

bool SoundBuffer::createFromMemory(const int16_t* data, uint32_t sampleCount,
                                   uint32_t sampleRate, AudioFormat format) {
    // Destroy existing buffer
    if (bufferId_) {
        destroy();
    }

    // Determine OpenAL format
    ALenum alFormat;
    switch (format) {
        case AudioFormat::Mono8:
            alFormat = AL_FORMAT_MONO8;
            channels_ = 1;
            bitsPerSample_ = 8;
            break;
        case AudioFormat::Mono16:
            alFormat = AL_FORMAT_MONO16;
            channels_ = 1;
            bitsPerSample_ = 16;
            break;
        case AudioFormat::Stereo8:
            alFormat = AL_FORMAT_STEREO8;
            channels_ = 2;
            bitsPerSample_ = 8;
            break;
        case AudioFormat::Stereo16:
            alFormat = AL_FORMAT_STEREO16;
            channels_ = 2;
            bitsPerSample_ = 16;
            break;
        default:
            std::cerr << "[SoundBuffer] Unsupported format" << std::endl;
            return false;
    }

    sampleRate_ = sampleRate;

    // Calculate size and duration
    size_ = sampleCount * (bitsPerSample_ / 8);
    duration_ = static_cast<float>(sampleCount) / (sampleRate * channels_);

    // Create OpenAL buffer
    alGenBuffers(1, &bufferId_);
    if (alGetError() != AL_NO_ERROR) {
        std::cerr << "[SoundBuffer] Failed to generate buffer" << std::endl;
        return false;
    }

    // Upload data to buffer
    alBufferData(bufferId_, alFormat, data, size_, sampleRate);
    if (alGetError() != AL_NO_ERROR) {
        std::cerr << "[SoundBuffer] Failed to upload buffer data" << std::endl;
        alDeleteBuffers(1, &bufferId_);
        bufferId_ = 0;
        return false;
    }

    std::cout << "[SoundBuffer] Created buffer (ID: " << bufferId_ << ", "
              << duration_ << " sec, " << (size_ / 1024.0f) << " KB)" << std::endl;

    return true;
}

void SoundBuffer::destroy() {
    if (bufferId_) {
        alDeleteBuffers(1, &bufferId_);
        bufferId_ = 0;
    }
}

std::string SoundBuffer::getFileExtension(const std::string& filepath) {
    size_t dotPos = filepath.find_last_of('.');
    if (dotPos == std::string::npos) {
        return "";
    }

    std::string ext = filepath.substr(dotPos + 1);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    return ext;
}

uint32_t SoundBuffer::getOpenALFormat(uint32_t channels, uint32_t bitsPerSample) {
    if (channels == 1) {
        return bitsPerSample == 8 ? AL_FORMAT_MONO8 : AL_FORMAT_MONO16;
    } else if (channels == 2) {
        return bitsPerSample == 8 ? AL_FORMAT_STEREO8 : AL_FORMAT_STEREO16;
    }
    return 0;
}

} // namespace tilt
