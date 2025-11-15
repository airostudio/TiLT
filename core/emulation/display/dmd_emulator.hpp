/*
 * DMD (Dot Matrix Display) Emulator
 */

#ifndef TILT_EMULATION_DISPLAY_DMD_EMULATOR_HPP
#define TILT_EMULATION_DISPLAY_DMD_EMULATOR_HPP

#include <cstdint>
#include <vector>

namespace tilt {

class DMDEmulator {
public:
    DMDEmulator(int width, int height);
    ~DMDEmulator();

    void update(float deltaTime);
    void reset();

    // Display control
    void setPixel(int x, int y, uint8_t intensity);
    uint8_t getPixel(int x, int y) const;
    void clear();

    // Buffer access
    const uint8_t* getBuffer() const { return buffer_.data(); }
    int getWidth() const { return width_; }
    int getHeight() const { return height_; }

private:
    int width_;
    int height_;
    std::vector<uint8_t> buffer_;
    std::vector<uint8_t> prevBuffer_;
};

} // namespace tilt

#endif // TILT_EMULATION_DISPLAY_DMD_EMULATOR_HPP
