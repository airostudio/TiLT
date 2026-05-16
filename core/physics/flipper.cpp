/*
 * Flipper Physics Implementation
 */

#include "flipper.hpp"
#include <algorithm>
#include <cmath>

namespace tilt {

Flipper::Flipper(const Vector3& position, bool isLeft)
    : position_(position)
    , angle_(0.0f)
    , angularVelocity_(0.0f)
    , targetAngle_(0.0f)
    , active_(false)
    , isLeft_(isLeft)
    , restAngle_(isLeft ? -20.0f : 20.0f)
    , activeAngle_(isLeft ? 45.0f : -45.0f)
    , strength_(10.0f)
    , returnStrength_(5.0f)
{
    angle_ = restAngle_;
}

Flipper::~Flipper() {}

void Flipper::update(float deltaTime) {
    // Determine target angle based on active state
    targetAngle_ = active_ ? activeAngle_ : restAngle_;

    // Calculate angular acceleration
    float angleDiff = targetAngle_ - angle_;
    float strength = active_ ? strength_ : returnStrength_;
    float angularAccel = angleDiff * strength;

    // Update angular velocity and angle
    angularVelocity_ += angularAccel * deltaTime;
    angularVelocity_ *= 0.9f; // Damping
    angle_ += angularVelocity_ * deltaTime;

    // Clamp angle
    float minAngle = std::min(restAngle_, activeAngle_);
    float maxAngle = std::max(restAngle_, activeAngle_);

    if (angle_ < minAngle) {
        angle_ = minAngle;
        angularVelocity_ = 0.0f;
    }
    if (angle_ > maxAngle) {
        angle_ = maxAngle;
        angularVelocity_ = 0.0f;
    }
}

void Flipper::reset() {
    angle_ = restAngle_;
    angularVelocity_ = 0.0f;
    active_ = false;
}

void Flipper::setActive(bool active) {
    active_ = active;
}

} // namespace tilt
