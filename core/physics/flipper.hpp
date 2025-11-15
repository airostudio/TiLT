/*
 * Flipper Physics
 */

#ifndef TILT_PHYSICS_FLIPPER_HPP
#define TILT_PHYSICS_FLIPPER_HPP

#include "ball.hpp"

namespace tilt {

class Flipper {
public:
    Flipper(const Vector3& position, bool isLeft);
    ~Flipper();

    void update(float deltaTime);
    void reset();

    // Control
    void setActive(bool active);
    bool isActive() const { return active_; }

    // Properties
    Vector3 getPosition() const { return position_; }
    float getAngle() const { return angle_; }
    float getAngularVelocity() const { return angularVelocity_; }

private:
    Vector3 position_;
    float angle_;
    float angularVelocity_;
    float targetAngle_;

    bool active_;
    bool isLeft_;

    float restAngle_;
    float activeAngle_;
    float strength_;
    float returnStrength_;
};

class PhysicsObject {
public:
    virtual ~PhysicsObject() {}
    virtual void update(float deltaTime) = 0;
};

} // namespace tilt

#endif // TILT_PHYSICS_FLIPPER_HPP
