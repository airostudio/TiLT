/*
 * Audio Engine (Production - OpenAL Integration)
 */

#ifndef TILT_AUDIO_ENGINE_HPP
#define TILT_AUDIO_ENGINE_HPP

#include <string>
#include <memory>

namespace tilt {

// Forward declarations
class AudioEngine;
class SoundBuffer;
class SoundSource;

} // namespace tilt

// Import the production OpenAL audio engine
#include "al_audio_engine.hpp"

#endif // TILT_AUDIO_ENGINE_HPP
