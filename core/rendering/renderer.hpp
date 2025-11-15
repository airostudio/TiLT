/*
 * Renderer - Base class for rendering backends
 */

#ifndef TILT_RENDERING_RENDERER_HPP
#define TILT_RENDERING_RENDERER_HPP

#include <string>

namespace tilt {

class PhysicsWorld;

class Renderer {
public:
    virtual ~Renderer() {}

    virtual void initialize() = 0;
    virtual void shutdown() = 0;

    virtual void loadTable(const std::string& tableFile) = 0;
    virtual void unloadTable() = 0;

    virtual void beginFrame() = 0;
    virtual void endFrame() = 0;

    virtual void renderPlayfield(PhysicsWorld* world) = 0;

    virtual void enableVR() = 0;
    virtual void disableVR() = 0;

    virtual void resize(int width, int height) = 0;
};

} // namespace tilt

#endif // TILT_RENDERING_RENDERER_HPP
