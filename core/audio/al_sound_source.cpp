/*
 * OpenAL Sound Source Implementation
 */

#include "al_sound_source.hpp"
#include "al_sound_buffer.hpp"
#include <AL/al.h>
#include <iostream>

namespace tilt {

SoundSource::SoundSource()
    : sourceId_(0)
    , buffer_(nullptr)
    , position_(0.0f)
    , velocity_(0.0f)
    , direction_(0.0f, 0.0f, -1.0f)
    , volume_(1.0f)
    , pitch_(1.0f)
    , looping_(false)
    , relativeToListener_(false)
    , minDistance_(1.0f)
    , maxDistance_(100.0f)
    , rolloffFactor_(1.0f)
    , coneInnerAngle_(360.0f)
    , coneOuterAngle_(360.0f)
    , coneOuterGain_(0.0f)
{
    // Create OpenAL source
    alGenSources(1, &sourceId_);
    if (alGetError() != AL_NO_ERROR) {
        std::cerr << "[SoundSource] Failed to generate source" << std::endl;
        sourceId_ = 0;
        return;
    }

    // Set default properties
    alSourcef(sourceId_, AL_GAIN, volume_);
    alSourcef(sourceId_, AL_PITCH, pitch_);
    alSourcei(sourceId_, AL_LOOPING, looping_ ? AL_TRUE : AL_FALSE);
    alSourcei(sourceId_, AL_SOURCE_RELATIVE, relativeToListener_ ? AL_TRUE : AL_FALSE);
    alSourcef(sourceId_, AL_REFERENCE_DISTANCE, minDistance_);
    alSourcef(sourceId_, AL_MAX_DISTANCE, maxDistance_);
    alSourcef(sourceId_, AL_ROLLOFF_FACTOR, rolloffFactor_);
    alSourcef(sourceId_, AL_CONE_INNER_ANGLE, coneInnerAngle_);
    alSourcef(sourceId_, AL_CONE_OUTER_ANGLE, coneOuterAngle_);
    alSourcef(sourceId_, AL_CONE_OUTER_GAIN, coneOuterGain_);
}

SoundSource::~SoundSource() {
    destroy();
}

void SoundSource::setBuffer(SoundBuffer* buffer) {
    buffer_ = buffer;
    if (buffer_ && buffer_->isValid()) {
        alSourcei(sourceId_, AL_BUFFER, buffer_->getBufferId());
    }
}

void SoundSource::play() {
    if (!isValid()) return;
    alSourcePlay(sourceId_);
}

void SoundSource::pause() {
    if (!isValid()) return;
    alSourcePause(sourceId_);
}

void SoundSource::stop() {
    if (!isValid()) return;
    alSourceStop(sourceId_);
}

void SoundSource::rewind() {
    if (!isValid()) return;
    alSourceRewind(sourceId_);
}

SourceState SoundSource::getState() const {
    if (!isValid()) return SourceState::Stopped;

    ALint state;
    alGetSourcei(sourceId_, AL_SOURCE_STATE, &state);

    switch (state) {
        case AL_INITIAL: return SourceState::Initial;
        case AL_PLAYING: return SourceState::Playing;
        case AL_PAUSED: return SourceState::Paused;
        case AL_STOPPED: return SourceState::Stopped;
        default: return SourceState::Stopped;
    }
}

bool SoundSource::isPlaying() const {
    return getState() == SourceState::Playing;
}

bool SoundSource::isPaused() const {
    return getState() == SourceState::Paused;
}

bool SoundSource::isStopped() const {
    SourceState state = getState();
    return state == SourceState::Stopped || state == SourceState::Initial;
}

void SoundSource::setPosition(const glm::vec3& position) {
    position_ = position;
    alSource3f(sourceId_, AL_POSITION, position.x, position.y, position.z);
}

void SoundSource::setVelocity(const glm::vec3& velocity) {
    velocity_ = velocity;
    alSource3f(sourceId_, AL_VELOCITY, velocity.x, velocity.y, velocity.z);
}

void SoundSource::setDirection(const glm::vec3& direction) {
    direction_ = direction;
    alSource3f(sourceId_, AL_DIRECTION, direction.x, direction.y, direction.z);
}

void SoundSource::setVolume(float volume) {
    volume_ = volume;
    alSourcef(sourceId_, AL_GAIN, volume);
}

void SoundSource::setPitch(float pitch) {
    pitch_ = pitch;
    alSourcef(sourceId_, AL_PITCH, pitch);
}

void SoundSource::setLooping(bool loop) {
    looping_ = loop;
    alSourcei(sourceId_, AL_LOOPING, loop ? AL_TRUE : AL_FALSE);
}

void SoundSource::setRelativeToListener(bool relative) {
    relativeToListener_ = relative;
    alSourcei(sourceId_, AL_SOURCE_RELATIVE, relative ? AL_TRUE : AL_FALSE);
}

void SoundSource::setMinDistance(float distance) {
    minDistance_ = distance;
    alSourcef(sourceId_, AL_REFERENCE_DISTANCE, distance);
}

void SoundSource::setMaxDistance(float distance) {
    maxDistance_ = distance;
    alSourcef(sourceId_, AL_MAX_DISTANCE, distance);
}

void SoundSource::setRolloffFactor(float factor) {
    rolloffFactor_ = factor;
    alSourcef(sourceId_, AL_ROLLOFF_FACTOR, factor);
}

void SoundSource::setConeInnerAngle(float angle) {
    coneInnerAngle_ = angle;
    alSourcef(sourceId_, AL_CONE_INNER_ANGLE, angle);
}

void SoundSource::setConeOuterAngle(float angle) {
    coneOuterAngle_ = angle;
    alSourcef(sourceId_, AL_CONE_OUTER_ANGLE, angle);
}

void SoundSource::setConeOuterGain(float gain) {
    coneOuterGain_ = gain;
    alSourcef(sourceId_, AL_CONE_OUTER_GAIN, gain);
}

void SoundSource::setPlaybackPosition(float seconds) {
    alSourcef(sourceId_, AL_SEC_OFFSET, seconds);
}

float SoundSource::getPlaybackPosition() const {
    float seconds;
    alGetSourcef(sourceId_, AL_SEC_OFFSET, &seconds);
    return seconds;
}

void SoundSource::destroy() {
    if (sourceId_) {
        alDeleteSources(1, &sourceId_);
        sourceId_ = 0;
    }
}

} // namespace tilt
