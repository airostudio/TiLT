/*
 * OpenAL Sound Source
 * 3D positioned audio source with full spatial audio support
 */

#pragma once

#include <cstdint>
#include <glm/glm.hpp>

namespace tilt {

class SoundBuffer;

/**
 * Sound source state
 */
enum class SourceState {
    Initial,
    Playing,
    Paused,
    Stopped
};

/**
 * Sound Source
 * Emits audio at a 3D position with full OpenAL features
 */
class SoundSource {
public:
    SoundSource();
    ~SoundSource();

    // Disable copy
    SoundSource(const SoundSource&) = delete;
    SoundSource& operator=(const SoundSource&) = delete;

    /**
     * Set sound buffer to play
     */
    void setBuffer(SoundBuffer* buffer);
    SoundBuffer* getBuffer() const { return buffer_; }

    /**
     * Playback control
     */
    void play();
    void pause();
    void stop();
    void rewind();

    /**
     * Get playback state
     */
    SourceState getState() const;
    bool isPlaying() const;
    bool isPaused() const;
    bool isStopped() const;

    /**
     * Position and velocity (for 3D audio)
     */
    void setPosition(const glm::vec3& position);
    glm::vec3 getPosition() const { return position_; }

    void setVelocity(const glm::vec3& velocity);
    glm::vec3 getVelocity() const { return velocity_; }

    void setDirection(const glm::vec3& direction);
    glm::vec3 getDirection() const { return direction_; }

    /**
     * Volume and pitch
     */
    void setVolume(float volume);
    float getVolume() const { return volume_; }

    void setPitch(float pitch);
    float getPitch() const { return pitch_; }

    /**
     * Looping
     */
    void setLooping(bool loop);
    bool isLooping() const { return looping_; }

    /**
     * 3D audio properties
     */
    void setRelativeToListener(bool relative);
    bool isRelativeToListener() const { return relativeToListener_; }

    void setMinDistance(float distance);
    float getMinDistance() const { return minDistance_; }

    void setMaxDistance(float distance);
    float getMaxDistance() const { return maxDistance_; }

    void setRolloffFactor(float factor);
    float getRolloffFactor() const { return rolloffFactor_; }

    /**
     * Cone (directional audio)
     */
    void setConeInnerAngle(float angle);
    float getConeInnerAngle() const { return coneInnerAngle_; }

    void setConeOuterAngle(float angle);
    float getConeOuterAngle() const { return coneOuterAngle_; }

    void setConeOuterGain(float gain);
    float getConeOuterGain() const { return coneOuterGain_; }

    /**
     * Playback position
     */
    void setPlaybackPosition(float seconds);
    float getPlaybackPosition() const;

    /**
     * Get OpenAL source ID
     */
    uint32_t getSourceId() const { return sourceId_; }

    /**
     * Check if valid
     */
    bool isValid() const { return sourceId_ != 0; }

    /**
     * Cleanup
     */
    void destroy();

private:
    uint32_t sourceId_;
    SoundBuffer* buffer_;

    // Cached properties
    glm::vec3 position_;
    glm::vec3 velocity_;
    glm::vec3 direction_;
    float volume_;
    float pitch_;
    bool looping_;
    bool relativeToListener_;
    float minDistance_;
    float maxDistance_;
    float rolloffFactor_;
    float coneInnerAngle_;
    float coneOuterAngle_;
    float coneOuterGain_;
};

} // namespace tilt
