/*
 * Sound Emulator - Pinball sound ROM emulation
 */

#ifndef TILT_EMULATION_SOUND_EMULATOR_HPP
#define TILT_EMULATION_SOUND_EMULATOR_HPP

#include <cstdint>
#include <vector>

namespace tilt {

class SoundEmulator {
public:
    SoundEmulator();
    ~SoundEmulator();

    void update(float deltaTime);
    void reset();

    // Sound control
    void playSound(int soundNum);
    void stopSound(int soundNum);
    void setVolume(float volume);

    // Audio output
    const int16_t* getAudioBuffer(int& sampleCount) const;
    int getSampleRate() const { return sampleRate_; }

private:
    void generateSamples(int numSamples);

    std::vector<int16_t> audioBuffer_;
    int sampleRate_;
    float volume_;
};

} // namespace tilt

#endif // TILT_EMULATION_SOUND_EMULATOR_HPP
