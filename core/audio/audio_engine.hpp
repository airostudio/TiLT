/*
 * Audio Engine
 */

#ifndef TILT_AUDIO_ENGINE_HPP
#define TILT_AUDIO_ENGINE_HPP

#include <string>

namespace tilt {

class AudioEngine {
public:
    AudioEngine();
    ~AudioEngine();

    void update(float deltaTime);

    // Playback control
    void playSound(const std::string& soundFile);
    void playMusic(const std::string& musicFile);
    void stopSound();
    void stopMusic();

    // Volume control
    void setMasterVolume(float volume);
    void setMusicVolume(float volume);
    void setSFXVolume(float volume);

private:
    bool initialized_;
    float masterVolume_;
    float musicVolume_;
    float sfxVolume_;
};

} // namespace tilt

#endif // TILT_AUDIO_ENGINE_HPP
