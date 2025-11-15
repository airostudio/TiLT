/*
 * Physics World - VPX-inspired physics simulation
 */

#ifndef TILT_PHYSICS_WORLD_HPP
#define TILT_PHYSICS_WORLD_HPP

#include <string>
#include <vector>
#include <memory>

namespace tilt {

class Ball;
class Flipper;
class PhysicsObject;

class PhysicsWorld {
public:
    PhysicsWorld();
    ~PhysicsWorld();

    // World control
    void loadTable(const std::string& tableFile);
    void unloadTable();
    void update(float deltaTime);
    void reset();

    // Ball management
    void addBall(float x, float y, float z);
    void removeBall(int index);
    int getBallCount() const;
    Ball* getBall(int index);

    // Physics parameters
    void setGravity(float gravity);
    float getGravity() const { return gravity_; }

    // Table elements
    void addFlipper(std::unique_ptr<Flipper> flipper);
    void addObject(std::unique_ptr<PhysicsObject> object);

    // Input
    void setFlipperState(int flipperIndex, bool active);

private:
    void updateBalls(float deltaTime);
    void updateFlippers(float deltaTime);
    void detectCollisions();
    void resolveCollisions();

    std::vector<std::unique_ptr<Ball>> balls_;
    std::vector<std::unique_ptr<Flipper>> flippers_;
    std::vector<std::unique_ptr<PhysicsObject>> objects_;

    float gravity_;
    float damping_;
    std::string currentTable_;
};

} // namespace tilt

#endif // TILT_PHYSICS_WORLD_HPP
