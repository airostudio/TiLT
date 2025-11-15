/*
 * Ball Physics Implementation
 */

#include "ball.hpp"
#include <cmath>

namespace tilt {

Ball::Ball(const Vector3& position)
    : position_(position)
    , velocity_(0, 0, 0)
    , acceleration_(0, 0, 0)
    , angularVelocity_(0, 0, 0)
    , radius_(0.027f)  // Standard pinball radius in meters
    , mass_(0.080f)    // Standard pinball mass in kg
    , restitution_(0.8f)
    , friction_(0.3f)
{}

Ball::~Ball() {}

void Ball::update(float deltaTime) {
    // Integrate velocity
    velocity_ = velocity_ + acceleration_ * deltaTime;

    // Integrate position
    position_ = position_ + velocity_ * deltaTime;

    // Reset acceleration for next frame
    acceleration_ = Vector3(0, 0, 0);

    // Simple boundary check (table bounds)
    if (position_.z < radius_) {
        position_.z = radius_;
        velocity_.z = -velocity_.z * restitution_;
    }
}

void Ball::reset() {
    velocity_ = Vector3(0, 0, 0);
    acceleration_ = Vector3(0, 0, 0);
    angularVelocity_ = Vector3(0, 0, 0);
}

void Ball::applyForce(const Vector3& force) {
    // F = ma, so a = F/m
    acceleration_ = acceleration_ + force * (1.0f / mass_);
}

void Ball::applyImpulse(const Vector3& impulse) {
    // J = mv, so v = J/m
    velocity_ = velocity_ + impulse * (1.0f / mass_);
}

} // namespace tilt
