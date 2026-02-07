/*
 * Audio Decoder Implementation
 * Uses dr_mp3, stb_vorbis, dr_flac for format support
 */

#include "audio_decoder.hpp"
#include <iostream>
#include <fstream>
#include <algorithm>
#include <cstring>

// Audio decoding libraries (header-only)
#define DR_MP3_IMPLEMENTATION
#include <dr_libs/dr_mp3.h>

#define DR_FLAC_IMPLEMENTATION
#include <dr_libs/dr_flac.h>

#define STB_VORBIS_HEADER_ONLY
#include <stb/stb_vorbis.c>

namespace tilt {

bool AudioDecoder::decode(const std::string& filepath, DecodedAudio& output) {
    // Determine format from extension
    std::string ext = filepath.substr(filepath.find_last_of('.') + 1);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

    if (ext == "wav") {
        return decodeWAV(filepath, output);
    } else if (ext == "mp3") {
        return decodeMP3(filepath, output);
    } else if (ext == "ogg") {
        return decodeOGG(filepath, output);
    } else if (ext == "flac") {
        return decodeFLAC(filepath, output);
    }

    std::cerr << "[AudioDecoder] Unsupported format: " << ext << std::endl;
    return false;
}

bool AudioDecoder::decodeWAV(const std::string& filepath, DecodedAudio& output) {
    std::ifstream file(filepath, std::ios::binary);
    if (!file.is_open()) {
        std::cerr << "[AudioDecoder] Failed to open WAV file: " << filepath << std::endl;
        return false;
    }

    // Read RIFF header
    WAVHeader header;
    file.read(reinterpret_cast<char*>(&header), sizeof(header));

    if (std::strncmp(header.riff, "RIFF", 4) != 0 || std::strncmp(header.wave, "WAVE", 4) != 0) {
        std::cerr << "[AudioDecoder] Invalid WAV file (bad header)" << std::endl;
        return false;
    }

    // Read format chunk
    WAVFormat format;
    file.read(reinterpret_cast<char*>(&format), sizeof(format));

    if (std::strncmp(format.fmt, "fmt ", 4) != 0) {
        std::cerr << "[AudioDecoder] Invalid WAV file (bad format chunk)" << std::endl;
        return false;
    }

    // Only support PCM
    if (format.audioFormat != 1) {
        std::cerr << "[AudioDecoder] Only PCM WAV files are supported" << std::endl;
        return false;
    }

    // Skip any extra format bytes
    if (format.chunkSize > 16) {
        file.seekg(format.chunkSize - 16, std::ios::cur);
    }

    // Find data chunk
    WAVData dataChunk;
    while (file.read(reinterpret_cast<char*>(&dataChunk), 8)) {
        if (std::strncmp(dataChunk.data, "data", 4) == 0) {
            break;
        }
        // Skip this chunk
        file.seekg(dataChunk.dataSize, std::ios::cur);
    }

    // Read audio data
    output.sampleRate = format.sampleRate;
    output.channels = format.channels;
    output.bitsPerSample = format.bitsPerSample;

    if (format.bitsPerSample == 16) {
        // Read directly as int16_t
        uint32_t sampleCount = dataChunk.dataSize / sizeof(int16_t);
        output.samples.resize(sampleCount);
        file.read(reinterpret_cast<char*>(output.samples.data()), dataChunk.dataSize);
    } else if (format.bitsPerSample == 8) {
        // Convert uint8_t to int16_t
        uint32_t sampleCount = dataChunk.dataSize;
        std::vector<uint8_t> data8(sampleCount);
        file.read(reinterpret_cast<char*>(data8.data()), dataChunk.dataSize);

        output.samples.resize(sampleCount);
        for (uint32_t i = 0; i < sampleCount; i++) {
            output.samples[i] = static_cast<int16_t>((data8[i] - 128) * 256);
        }
    } else {
        std::cerr << "[AudioDecoder] Unsupported bits per sample: " << format.bitsPerSample << std::endl;
        return false;
    }

    std::cout << "[AudioDecoder] Loaded WAV: " << filepath << " ("
              << output.channels << " ch, " << output.sampleRate << " Hz, "
              << output.getDuration() << " sec)" << std::endl;

    return true;
}

bool AudioDecoder::decodeMP3(const std::string& filepath, DecodedAudio& output) {
    drmp3 mp3;
    if (!drmp3_init_file(&mp3, filepath.c_str(), nullptr)) {
        std::cerr << "[AudioDecoder] Failed to open MP3 file: " << filepath << std::endl;
        return false;
    }

    // Get total PCM frame count
    drmp3_uint64 totalFrames = drmp3_get_pcm_frame_count(&mp3);
    if (totalFrames == 0) {
        std::cerr << "[AudioDecoder] MP3 file has no frames: " << filepath << std::endl;
        drmp3_uninit(&mp3);
        return false;
    }

    // Decode entire file
    output.channels = mp3.channels;
    output.sampleRate = mp3.sampleRate;
    output.bitsPerSample = 16;

    uint32_t sampleCount = totalFrames * mp3.channels;
    output.samples.resize(sampleCount);

    drmp3_uint64 framesRead = drmp3_read_pcm_frames_s16(&mp3, totalFrames, output.samples.data());
    output.samples.resize(framesRead * mp3.channels);

    drmp3_uninit(&mp3);

    std::cout << "[AudioDecoder] Loaded MP3: " << filepath << " ("
              << output.channels << " ch, " << output.sampleRate << " Hz, "
              << output.getDuration() << " sec)" << std::endl;

    return true;
}

bool AudioDecoder::decodeOGG(const std::string& filepath, DecodedAudio& output) {
    int channels, sampleRate;
    short* decoded;
    int sampleCount = stb_vorbis_decode_filename(filepath.c_str(), &channels, &sampleRate, &decoded);

    if (sampleCount < 0) {
        std::cerr << "[AudioDecoder] Failed to decode OGG file: " << filepath << std::endl;
        return false;
    }

    output.channels = channels;
    output.sampleRate = sampleRate;
    output.bitsPerSample = 16;

    // Copy data
    uint32_t totalSamples = sampleCount * channels;
    output.samples.resize(totalSamples);
    std::memcpy(output.samples.data(), decoded, totalSamples * sizeof(int16_t));

    // Free stb_vorbis memory
    free(decoded);

    std::cout << "[AudioDecoder] Loaded OGG: " << filepath << " ("
              << output.channels << " ch, " << output.sampleRate << " Hz, "
              << output.getDuration() << " sec)" << std::endl;

    return true;
}

bool AudioDecoder::decodeFLAC(const std::string& filepath, DecodedAudio& output) {
    drflac* flac = drflac_open_file(filepath.c_str(), nullptr);
    if (!flac) {
        std::cerr << "[AudioDecoder] Failed to open FLAC file: " << filepath << std::endl;
        return false;
    }

    output.channels = flac->channels;
    output.sampleRate = flac->sampleRate;
    output.bitsPerSample = 16;

    // Decode entire file
    uint32_t sampleCount = flac->totalPCMFrameCount * flac->channels;
    output.samples.resize(sampleCount);

    drflac_uint64 framesRead = drflac_read_pcm_frames_s16(flac, flac->totalPCMFrameCount, output.samples.data());
    output.samples.resize(framesRead * flac->channels);

    drflac_close(flac);

    std::cout << "[AudioDecoder] Loaded FLAC: " << filepath << " ("
              << output.channels << " ch, " << output.sampleRate << " Hz, "
              << output.getDuration() << " sec)" << std::endl;

    return true;
}

bool AudioDecoder::isFormatSupported(const std::string& extension) {
    std::string ext = extension;
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

    return (ext == "wav" || ext == "mp3" || ext == "ogg" || ext == "flac");
}

std::vector<std::string> AudioDecoder::getSupportedFormats() {
    return {"wav", "mp3", "ogg", "flac"};
}

} // namespace tilt
