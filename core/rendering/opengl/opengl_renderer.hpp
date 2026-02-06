/*
 * OpenGL Renderer (Production)
 */

#ifndef TILT_RENDERING_OPENGL_RENDERER_HPP
#define TILT_RENDERING_OPENGL_RENDERER_HPP

#include "../renderer.hpp"
#include <memory>

namespace tilt {

// Forward declarations
class Window;
class ShaderLibrary;
class TextureLibrary;
class Camera;
class Mesh;

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

    // Additional methods
    bool shouldClose() const;

private:
    bool initialized_;
    bool vrEnabled_;
    int width_;
    int height_;

    // Rendering resources
    std::unique_ptr<Window> window_;
    std::unique_ptr<ShaderLibrary> shaderLibrary_;
    std::unique_ptr<TextureLibrary> textureLibrary_;
    std::unique_ptr<Camera> camera_;

    // Test mesh (will be replaced with table geometry)
    Mesh* testMesh_;
};

} // namespace tilt

#endif // TILT_RENDERING_OPENGL_RENDERER_HPP
