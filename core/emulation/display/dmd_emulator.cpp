/*
 * DMD Emulator Implementation
 */

#include "dmd_emulator.hpp"
#include <iostream>
#include <algorithm>

namespace tilt {

DMDEmulator::DMDEmulator(int width, int height)
    : width_(width)
    , height_(height)
{
    buffer_.resize(width * height, 0);
    prevBuffer_.resize(width * height, 0);
    std::cout << "[DMD Emulator] Initialized " << width << "x" << height << std::endl;
}

DMDEmulator::~DMDEmulator() {}

void DMDEmulator::update(float deltaTime) {
    // Update DMD display with PWM shading, etc.
}

void DMDEmulator::reset() {
    clear();
}

void DMDEmulator::setPixel(int x, int y, uint8_t intensity) {
    if (x >= 0 && x < width_ && y >= 0 && y < height_) {
        buffer_[y * width_ + x] = intensity;
    }
}

uint8_t DMDEmulator::getPixel(int x, int y) const {
    if (x >= 0 && x < width_ && y >= 0 && y < height_) {
        return buffer_[y * width_ + x];
    }
    return 0;
}

void DMDEmulator::clear() {
    std::fill(buffer_.begin(), buffer_.end(), 0);
}

} // namespace tilt
