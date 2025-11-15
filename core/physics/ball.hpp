/*
 * Ball Physics
 */

#ifndef TILT_PHYSICS_BALL_HPP
#define TILT_PHYSICS_BALL_HPP

namespace tilt {

struct Vector3 {
    float x, y, z;

    Vector3() : x(0), y(0), z(0) {}
    Vector3(float _x, float _y, float _z) : x(_x), y(_y), z(_z) {}

    Vector3 operator+(const Vector3& other) const {
        return Vector3(x + other.x, y + other.y, z + other.z);
    }

    Vector3 operator-(const Vector3& other) const {
        return Vector3(x - other.x, y - other.y, z - other.z);
    }

    Vector3 operator*(float scalar) const {
        return Vector3(x * scalar, y * scalar, z * scalar);
    }

    float length() const {
        return std::sqrt(x * x + y * y + z * z);
    }

    Vector3 normalized() const {
        float len = length();
        if (len > 0.0f) {
            return *this * (1.0f / len);
        }
        return *this;
    }
};

class Ball {
public:
    Ball(const Vector3& position);
    ~Ball();

    void update(float deltaTime);
    void reset();

    // Physics
    void applyForce(const Vector3& force);
    void applyImpulse(const Vector3& impulse);

    // Properties
    Vector3 getPosition() const { return position_; }
    void setPosition(const Vector3& pos) { position_ = pos; }

    Vector3 getVelocity() const { return velocity_; }
    void setVelocity(const Vector3& vel) { velocity_ = vel; }

    Vector3 getAngularVelocity() const { return angularVelocity_; }
    void setAngularVelocity(const Vector3& omega) { angularVelocity_ = omega; }

    float getRadius() const { return radius_; }
    float getMass() const { return mass_; }

private:
    Vector3 position_;
    Vector3 velocity_;
    Vector3 acceleration_;
    Vector3 angularVelocity_;

    float radius_;
    float mass_;
    float restitution_;  // Bounciness
    float friction_;
};

} // namespace tilt

#endif // TILT_PHYSICS_BALL_HPP
