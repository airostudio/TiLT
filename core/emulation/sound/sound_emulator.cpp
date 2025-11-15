/*
 * Sound Emulator Implementation
 */

#include "sound_emulator.hpp"
#include <iostream>

namespace tilt {

SoundEmulator::SoundEmulator()
    : sampleRate_(48000)
    , volume_(1.0f)
{
    audioBuffer_.resize(4096, 0);
    std::cout << "[Sound Emulator] Initialized (48kHz)" << std::endl;
}

SoundEmulator::~SoundEmulator() {}

void SoundEmulator::update(float deltaTime) {
    // Generate audio samples based on deltaTime
    int samplesNeeded = static_cast<int>(sampleRate_ * deltaTime);
    generateSamples(samplesNeeded);
}

void SoundEmulator::reset() {
    std::fill(audioBuffer_.begin(), audioBuffer_.end(), 0);
}

void SoundEmulator::playSound(int soundNum) {
    // Trigger sound playback
    std::cout << "[Sound Emulator] Playing sound: " << soundNum << std::endl;
}

void SoundEmulator::stopSound(int soundNum) {
    std::cout << "[Sound Emulator] Stopping sound: " << soundNum << std::endl;
}

void SoundEmulator::setVolume(float volume) {
    volume_ = volume;
}

const int16_t* SoundEmulator::getAudioBuffer(int& sampleCount) const {
    sampleCount = static_cast<int>(audioBuffer_.size());
    return audioBuffer_.data();
}

void SoundEmulator::generateSamples(int numSamples) {
    // Generate audio samples
    // This would mix sound ROM samples, synthesized sounds, etc.
    if (numSamples > static_cast<int>(audioBuffer_.size())) {
        audioBuffer_.resize(numSamples);
    }
}

} // namespace tilt
