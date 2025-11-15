/*
 * Backglass Renderer - B2S-inspired backglass rendering
 */

#ifndef TILT_DISPLAY_BACKGLASS_RENDERER_HPP
#define TILT_DISPLAY_BACKGLASS_RENDERER_HPP

#include <string>
#include <vector>
#include <memory>

namespace tilt {

struct BackglassLayer {
    std::string imagePath;
    float x, y;
    float width, height;
    float opacity;
    bool visible;
};

struct BackglassLamp {
    int lampNumber;
    float x, y;
    float width, height;
    uint8_t intensity;
    bool isLED;
};

class BackglassRenderer {
public:
    BackglassRenderer();
    ~BackglassRenderer();

    // Loading
    void loadBackglass(const std::string& b2sFile);
    void unloadBackglass();

    // Rendering
    void render();
    void update(float deltaTime);

    // Lamp control
    void setLampIntensity(int lampNum, uint8_t intensity);

    // Display control
    void setDMDDisplay(const uint8_t* buffer, int width, int height);

private:
    void parseB2SFile(const std::string& filename);

    std::vector<BackglassLayer> layers_;
    std::vector<BackglassLamp> lamps_;

    bool loaded_;
    int width_;
    int height_;
};

} // namespace tilt

#endif // TILT_DISPLAY_BACKGLASS_RENDERER_HPP
