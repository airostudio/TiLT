/*
 * WebGL Renderer
 * Emscripten/WebGL2 rendering backend for the web build.
 */

#ifndef TILT_RENDERING_WEBGL_RENDERER_HPP
#define TILT_RENDERING_WEBGL_RENDERER_HPP

#ifdef __EMSCRIPTEN__

#include "../renderer.hpp"
#include <string>

// glm is header-only; fall back to a plain struct if it is not available in
// the vendor tree so the header still parses cleanly.
#if __has_include(<glm/vec4.hpp>)
#  include <glm/vec4.hpp>
#  define TILT_HAS_GLM 1
#else
namespace glm { struct vec4 { float r, g, b, a; }; }
#endif

namespace tilt {

class WebGLRenderer : public Renderer {
public:
    WebGLRenderer();
    ~WebGLRenderer() override;

    // Renderer interface
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

    // WebGL-specific helpers
    void setClearColor(float r, float g, float b, float a = 1.0f);

private:
    bool        initialized_;
    int         canvasWidth_;
    int         canvasHeight_;
    glm::vec4   clearColor_;

    // Emscripten WebGL context handle (int)
    int         glContext_;
};

} // namespace tilt

#endif // __EMSCRIPTEN__
#endif // TILT_RENDERING_WEBGL_RENDERER_HPP
