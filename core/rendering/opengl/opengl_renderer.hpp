/*
 * OpenGL Renderer
 */

#ifndef TILT_RENDERING_OPENGL_RENDERER_HPP
#define TILT_RENDERING_OPENGL_RENDERER_HPP

#include "../renderer.hpp"

namespace tilt {

class OpenGLRenderer : public Renderer {
public:
    OpenGLRenderer();
    ~OpenGLRenderer() override;

    void initialize() override;
    void shutdown() override;

    void loadTable(const std::string& tableFile) override;
    void unloadTable() override;

    void beginFrame() override;
    void endFrame() override;

    void renderPlayfield(PhysicsWorld* world) override;

    void enableVR() override;
    void disableVR() override;

    void resize(int width, int height) override;

private:
    bool initialized_;
    bool vrEnabled_;
    int width_;
    int height_;
};

} // namespace tilt

#endif // TILT_RENDERING_OPENGL_RENDERER_HPP
