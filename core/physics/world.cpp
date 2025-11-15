/*
 * Physics World Implementation
 */

#include "world.hpp"
#include "ball.hpp"
#include "flipper.hpp"
#include <iostream>

namespace tilt {

PhysicsWorld::PhysicsWorld()
    : gravity_(9.81f)
    , damping_(0.95f)
{
    std::cout << "[Physics] World initialized" << std::endl;
}

PhysicsWorld::~PhysicsWorld() {}

void PhysicsWorld::loadTable(const std::string& tableFile) {
    std::cout << "[Physics] Loading table: " << tableFile << std::endl;
    currentTable_ = tableFile;

    // Parse table file and create physics objects
    // This would load VPX table format and create corresponding physics objects

    // For now, create a simple demo table
    reset();

    // Add flippers
    auto leftFlipper = std::make_unique<Flipper>(Vector3(-0.2f, -0.8f, 0.0f), true);
    auto rightFlipper = std::make_unique<Flipper>(Vector3(0.2f, -0.8f, 0.0f), false);

    addFlipper(std::move(leftFlipper));
    addFlipper(std::move(rightFlipper));

    // Add a ball
    addBall(0.0f, 0.5f, 0.1f);

    std::cout << "[Physics] Table loaded with " << flippers_.size() << " flippers" << std::endl;
}

void PhysicsWorld::unloadTable() {
    if (!currentTable_.empty()) {
        std::cout << "[Physics] Unloading table: " << currentTable_ << std::endl;
        balls_.clear();
        flippers_.clear();
        objects_.clear();
        currentTable_.clear();
    }
}

void PhysicsWorld::update(float deltaTime) {
    // Update physics simulation
    updateBalls(deltaTime);
    updateFlippers(deltaTime);
    detectCollisions();
    resolveCollisions();
}

void PhysicsWorld::reset() {
    balls_.clear();
    for (auto& flipper : flippers_) {
        flipper->reset();
    }
}

void PhysicsWorld::addBall(float x, float y, float z) {
    auto ball = std::make_unique<Ball>(Vector3(x, y, z));
    balls_.push_back(std::move(ball));
    std::cout << "[Physics] Ball added at (" << x << ", " << y << ", " << z << ")" << std::endl;
}

void PhysicsWorld::removeBall(int index) {
    if (index >= 0 && index < static_cast<int>(balls_.size())) {
        balls_.erase(balls_.begin() + index);
    }
}

int PhysicsWorld::getBallCount() const {
    return static_cast<int>(balls_.size());
}

Ball* PhysicsWorld::getBall(int index) {
    if (index >= 0 && index < static_cast<int>(balls_.size())) {
        return balls_[index].get();
    }
    return nullptr;
}

void PhysicsWorld::setGravity(float gravity) {
    gravity_ = gravity;
}

void PhysicsWorld::addFlipper(std::unique_ptr<Flipper> flipper) {
    flippers_.push_back(std::move(flipper));
}

void PhysicsWorld::addObject(std::unique_ptr<PhysicsObject> object) {
    objects_.push_back(std::move(object));
}

void PhysicsWorld::setFlipperState(int flipperIndex, bool active) {
    if (flipperIndex >= 0 && flipperIndex < static_cast<int>(flippers_.size())) {
        flippers_[flipperIndex]->setActive(active);
    }
}

void PhysicsWorld::updateBalls(float deltaTime) {
    for (auto& ball : balls_) {
        // Apply gravity
        ball->applyForce(Vector3(0.0f, -gravity_, 0.0f));

        // Update ball physics
        ball->update(deltaTime);

        // Apply damping
        ball->setVelocity(ball->getVelocity() * damping_);
    }
}

void PhysicsWorld::updateFlippers(float deltaTime) {
    for (auto& flipper : flippers_) {
        flipper->update(deltaTime);
    }
}

void PhysicsWorld::detectCollisions() {
    // Detect collisions between balls and objects
    // Simplified for now
}

void PhysicsWorld::resolveCollisions() {
    // Resolve detected collisions
    // Simplified for now
}

} // namespace tilt
