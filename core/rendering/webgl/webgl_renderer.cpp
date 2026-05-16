/*
 * WebGL Renderer Implementation
 * Uses Emscripten's WebGL2 bindings (GLES3 / html5.h API).
 *
 * Compiled only when targeting Emscripten/WASM.
 */

#ifdef __EMSCRIPTEN__

#include "webgl_renderer.hpp"
#include "../../physics/world.hpp"

#include <emscripten.h>
#include <emscripten/html5.h>
#include <GLES3/gl3.h>

#include <iostream>
#include <string>

namespace tilt {

// ---------------------------------------------------------------------------
// Construction / destruction
// ---------------------------------------------------------------------------

WebGLRenderer::WebGLRenderer()
    : initialized_(false)
    , canvasWidth_(1280)
    , canvasHeight_(720)
    , clearColor_{ 0.0f, 0.0f, 0.0f, 1.0f }
    , glContext_(0)
{
    std::cout << "[WebGL] Renderer created" << std::endl;
    initialize();
}

WebGLRenderer::~WebGLRenderer() {
    shutdown();
}

// ---------------------------------------------------------------------------
// initialize()
// ---------------------------------------------------------------------------

void WebGLRenderer::initialize() {
    if (initialized_) return;

    std::cout << "[WebGL] Initializing WebGL2 context..." << std::endl;

    // ---- Request a WebGL2 context on the #canvas element ----
    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);

    attrs.majorVersion        = 2;      // WebGL 2 (GLES 3)
    attrs.minorVersion        = 0;
    attrs.alpha               = EM_FALSE;
    attrs.depth               = EM_TRUE;
    attrs.stencil             = EM_FALSE;
    attrs.antialias           = EM_TRUE;
    attrs.premultipliedAlpha  = EM_FALSE;
    attrs.preserveDrawingBuffer = EM_FALSE;
    attrs.powerPreference     = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
    attrs.failIfMajorPerformanceCaveat = EM_FALSE;
    attrs.enableExtensionsByDefault    = EM_TRUE;

    glContext_ = emscripten_webgl_create_context("#canvas", &attrs);
    if (glContext_ <= 0) {
        std::cerr << "[WebGL] Failed to create WebGL2 context (error "
                  << glContext_ << ")" << std::endl;
        return;
    }

    EMSCRIPTEN_RESULT res = emscripten_webgl_make_context_current(glContext_);
    if (res != EMSCRIPTEN_RESULT_SUCCESS) {
        std::cerr << "[WebGL] Failed to make context current (error "
                  << res << ")" << std::endl;
        return;
    }

    // ---- Print GL version / renderer info ----
    const GLubyte* version  = glGetString(GL_VERSION);
    const GLubyte* vendor   = glGetString(GL_VENDOR);
    const GLubyte* renderer = glGetString(GL_RENDERER);
    const GLubyte* glsl     = glGetString(GL_SHADING_LANGUAGE_VERSION);

    std::cout << "[WebGL] GL Version  : "
              << (version  ? reinterpret_cast<const char*>(version)  : "unknown") << std::endl;
    std::cout << "[WebGL] GL Vendor   : "
              << (vendor   ? reinterpret_cast<const char*>(vendor)   : "unknown") << std::endl;
    std::cout << "[WebGL] GL Renderer : "
              << (renderer ? reinterpret_cast<const char*>(renderer) : "unknown") << std::endl;
    std::cout << "[WebGL] GLSL        : "
              << (glsl     ? reinterpret_cast<const char*>(glsl)     : "unknown") << std::endl;

    // ---- Initial viewport / clear state ----
    glViewport(0, 0, canvasWidth_, canvasHeight_);
    glClearColor(clearColor_.r, clearColor_.g, clearColor_.b, clearColor_.a);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    // Basic GL state
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LEQUAL);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    initialized_ = true;
    std::cout << "[WebGL] Renderer initialized (" << canvasWidth_
              << "x" << canvasHeight_ << ")" << std::endl;
}

// ---------------------------------------------------------------------------
// shutdown()
// ---------------------------------------------------------------------------

void WebGLRenderer::shutdown() {
    if (!initialized_) return;

    std::cout << "[WebGL] Shutting down renderer..." << std::endl;

    if (glContext_ > 0) {
        emscripten_webgl_destroy_context(glContext_);
        glContext_ = 0;
    }

    initialized_ = false;
    std::cout << "[WebGL] Renderer shut down" << std::endl;
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

void WebGLRenderer::beginFrame() {
    if (!initialized_) return;

    emscripten_webgl_make_context_current(glContext_);

    glClearColor(clearColor_.r, clearColor_.g, clearColor_.b, clearColor_.a);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
}

void WebGLRenderer::endFrame() {
    // WebGL in Emscripten flushes automatically at the end of each browser
    // animation frame; glFlush() is a no-op hint for consistency.
    glFlush();
}

// ---------------------------------------------------------------------------
// Table management
// ---------------------------------------------------------------------------

void WebGLRenderer::loadTable(const std::string& tableFile) {
    std::cout << "[WebGL] Loading table: " << tableFile << std::endl;
    // Upload table geometry, textures, and material data to GPU buffers.
    // Full VPX / FPT mesh loading is wired through the scripting subsystem;
    // placeholder logic lives here until that pipeline is complete.
}

void WebGLRenderer::unloadTable() {
    std::cout << "[WebGL] Unloading table" << std::endl;
    // Release all GPU resources associated with the current table.
}

// ---------------------------------------------------------------------------
// renderPlayfield()
// ---------------------------------------------------------------------------

void WebGLRenderer::renderPlayfield(PhysicsWorld* world) {
    if (!initialized_ || !world) return;

    // Render order:
    //   1. Playfield mesh + textures
    //   2. Static inserts / plastics
    //   3. Ball(s)
    //   4. Flippers
    //   5. Solenoid-driven objects (bumpers, kickers)
    //   6. Lighting pass (emissive + point lights)
    //   7. DMD overlay (if applicable)
    //
    // Full implementation is driven by the scene graph assembled in loadTable().
    // For now just ensure the clear + depth state is correct each frame.
    glEnable(GL_DEPTH_TEST);
}

// ---------------------------------------------------------------------------
// VR support (unsupported on WebGL path)
// ---------------------------------------------------------------------------

void WebGLRenderer::enableVR() {
    std::cout << "[WebGL] VR mode is not supported on the WebGL backend" << std::endl;
}

void WebGLRenderer::disableVR() {
    std::cout << "[WebGL] VR mode was not active on the WebGL backend" << std::endl;
}

// ---------------------------------------------------------------------------
// resize()
// ---------------------------------------------------------------------------

void WebGLRenderer::resize(int width, int height) {
    canvasWidth_  = width;
    canvasHeight_ = height;

    if (initialized_) {
        emscripten_webgl_make_context_current(glContext_);
        glViewport(0, 0, canvasWidth_, canvasHeight_);
    }

    std::cout << "[WebGL] Resized to " << width << "x" << height << std::endl;
}

// ---------------------------------------------------------------------------
// setClearColor()
// ---------------------------------------------------------------------------

void WebGLRenderer::setClearColor(float r, float g, float b, float a) {
    clearColor_ = { r, g, b, a };
}

} // namespace tilt

#endif // __EMSCRIPTEN__
