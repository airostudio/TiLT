/*
 * OpenGL Renderer Implementation (Production)
 * Integrated with Window, Shader, Texture, Mesh, and Camera systems
 */

#include "opengl_renderer.hpp"
#include "../../physics/world.hpp"
#include "../window.hpp"
#include "gl_shader.hpp"
#include "gl_texture.hpp"
#include "gl_mesh.hpp"
#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <iostream>

namespace tilt {

OpenGLRenderer::OpenGLRenderer()
    : initialized_(false)
    , vrEnabled_(false)
    , width_(1920)
    , height_(1080)
{
    std::cout << "[OpenGL] Renderer created" << std::endl;
}

OpenGLRenderer::~OpenGLRenderer() {
    shutdown();
}

void OpenGLRenderer::initialize() {
    if (initialized_) return;

    std::cout << "[OpenGL] Initializing production renderer..." << std::endl;

    // Create window
    window_ = std::make_unique<Window>();
    WindowConfig config;
    config.width = width_;
    config.height = height_;
    config.title = "TiLT - Totally Integrated Luxurious Tables";
    config.vsync = true;
    config.msaaSamples = 4;

    if (!window_->initialize(config)) {
        std::cerr << "[OpenGL] Failed to create window" << std::endl;
        return;
    }

    // Load OpenGL functions with GLAD
    if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
        std::cerr << "[OpenGL] Failed to initialize GLAD" << std::endl;
        return;
    }

    std::cout << "[OpenGL] GLAD initialized" << std::endl;
    std::cout << "[OpenGL] OpenGL Version: " << glGetString(GL_VERSION) << std::endl;
    std::cout << "[OpenGL] GLSL Version: " << glGetString(GL_SHADING_LANGUAGE_VERSION) << std::endl;

    // Set OpenGL state
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_CULL_FACE);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    // Create shader library
    shaderLibrary_ = std::make_unique<ShaderLibrary>();

    // Create built-in shaders
    Shader* simpleShader = new Shader();
    simpleShader->createFromSource(BuiltInShaders::SimpleVertex, BuiltInShaders::SimpleFragment);
    shaderLibrary_->add("simple", simpleShader);

    Shader* standardShader = new Shader();
    standardShader->createFromSource(BuiltInShaders::StandardVertex, BuiltInShaders::StandardFragment);
    shaderLibrary_->add("standard", standardShader);

    Shader* dmdShader = new Shader();
    dmdShader->createFromSource(BuiltInShaders::DMDVertex, BuiltInShaders::DMDFragment);
    shaderLibrary_->add("dmd", dmdShader);

    // Create texture library and default textures
    textureLibrary_ = std::make_unique<TextureLibrary>();
    textureLibrary_->createDefaultTextures();

    // Create camera
    camera_ = std::make_unique<Camera>();
    camera_->setPerspective(45.0f, static_cast<float>(width_) / height_, 0.1f, 1000.0f);
    camera_->setPosition(glm::vec3(0.0f, 5.0f, 10.0f));
    camera_->lookAt(glm::vec3(0.0f, 0.0f, 0.0f));

    // Create test mesh (cube)
    testMesh_ = Mesh::createCube(1.0f);

    // Set clear color
    glClearColor(0.1f, 0.1f, 0.15f, 1.0f);

    initialized_ = true;
    std::cout << "[OpenGL] Production renderer initialized successfully" << std::endl;
}

void OpenGLRenderer::shutdown() {
    if (!initialized_) return;

    std::cout << "[OpenGL] Shutting down renderer..." << std::endl;

    // Cleanup resources
    if (testMesh_) {
        delete testMesh_;
        testMesh_ = nullptr;
    }

    shaderLibrary_.reset();
    textureLibrary_.reset();
    camera_.reset();
    window_.reset();

    initialized_ = false;
    std::cout << "[OpenGL] Renderer shutdown complete" << std::endl;
}

void OpenGLRenderer::loadTable(const std::string& tableFile) {
    std::cout << "[OpenGL] Loading table: " << tableFile << std::endl;
    // TODO: Load VPX/FP table file and create meshes/textures
}

void OpenGLRenderer::unloadTable() {
    std::cout << "[OpenGL] Unloading table" << std::endl;
    // TODO: Cleanup table resources
}

void OpenGLRenderer::beginFrame() {
    if (!initialized_) return;

    // Clear buffers
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    // Update viewport
    uint32_t fbWidth, fbHeight;
    window_->getFramebufferSize(fbWidth, fbHeight);
    glViewport(0, 0, fbWidth, fbHeight);
}

void OpenGLRenderer::endFrame() {
    if (!initialized_) return;

    // Swap buffers
    window_->swapBuffers();

    // Poll events
    window_->pollEvents();
}

void OpenGLRenderer::renderPlayfield(PhysicsWorld* world) {
    if (!initialized_ || !testMesh_) return;

    // Get shader
    Shader* shader = shaderLibrary_->get("standard");
    if (!shader) return;

    // Bind shader
    shader->bind();

    // Set matrices
    shader->setUniform("uProjection", camera_->getProjectionMatrix());
    shader->setUniform("uView", camera_->getViewMatrix());

    // Model matrix (spinning cube demo)
    static float rotation = 0.0f;
    rotation += 0.01f;
    glm::mat4 model = glm::rotate(glm::mat4(1.0f), rotation, glm::vec3(0.5f, 1.0f, 0.0f));
    shader->setUniform("uModel", model);

    // Normal matrix
    glm::mat4 normalMatrix = glm::transpose(glm::inverse(model));
    shader->setUniform("uNormalMatrix", normalMatrix);

    // Lighting
    shader->setUniform("uLightPos", glm::vec3(5.0f, 5.0f, 5.0f));
    shader->setUniform("uViewPos", camera_->getPosition());
    shader->setUniform("uColor", glm::vec4(1.0f, 1.0f, 1.0f, 1.0f));

    // Bind texture
    Texture2D* texture = textureLibrary_->get("checkerboard");
    if (texture) {
        shader->setTexture("uTexture", texture->getTextureId(), 0);
    }

    // Draw mesh
    testMesh_->draw();

    shader->unbind();
}

bool OpenGLRenderer::shouldClose() const {
    return window_ ? window_->shouldClose() : true;
}

void OpenGLRenderer::enableVR() {
    vrEnabled_ = true;
    std::cout << "[OpenGL] VR mode enabled" << std::endl;
}

void OpenGLRenderer::disableVR() {
    vrEnabled_ = false;
    std::cout << "[OpenGL] VR mode disabled" << std::endl;
}

void OpenGLRenderer::resize(int width, int height) {
    width_ = width;
    height_ = height;
    std::cout << "[OpenGL] Resized to " << width << "x" << height << std::endl;

    // Update camera aspect ratio
    if (camera_) {
        camera_->setPerspective(45.0f, static_cast<float>(width) / height, 0.1f, 1000.0f);
    }
}

} // namespace tilt
