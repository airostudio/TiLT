/*
 * Window Management System Implementation
 */

#include "window.hpp"
#include <GLFW/glfw3.h>
#include <iostream>
#include <stdexcept>

namespace tilt {

// Static GLFW initialization counter
static int glfwRefCount = 0;

Window::Window()
    : window_(nullptr)
    , monitor_(nullptr)
    , initialized_(false)
    , fullscreen_(false)
    , vsync_(true)
    , windowedWidth_(1920)
    , windowedHeight_(1080)
    , windowedPosX_(0)
    , windowedPosY_(0)
{
}

Window::~Window() {
    shutdown();
}

bool Window::initialize(const WindowConfig& config) {
    if (initialized_) {
        std::cerr << "[Window] Already initialized" << std::endl;
        return false;
    }

    config_ = config;

    // Initialize GLFW on first window
    if (glfwRefCount == 0) {
        glfwSetErrorCallback(errorCallback);

        if (!glfwInit()) {
            std::cerr << "[Window] Failed to initialize GLFW" << std::endl;
            return false;
        }

        std::cout << "[Window] GLFW initialized: " << glfwGetVersionString() << std::endl;
    }
    glfwRefCount++;

    // Create window and OpenGL context
    if (!createWindow()) {
        return false;
    }

    if (!createOpenGLContext()) {
        glfwDestroyWindow(window_);
        window_ = nullptr;
        return false;
    }

    // Setup callbacks
    setupCallbacks();

    // Set VSync
    setVSync(config_.vsync);

    initialized_ = true;
    std::cout << "[Window] Window created: " << config_.width << "x" << config_.height << std::endl;

    return true;
}

void Window::shutdown() {
    if (!initialized_) {
        return;
    }

    if (window_) {
        glfwDestroyWindow(window_);
        window_ = nullptr;
    }

    glfwRefCount--;
    if (glfwRefCount == 0) {
        glfwTerminate();
        std::cout << "[Window] GLFW terminated" << std::endl;
    }

    initialized_ = false;
}

bool Window::createWindow() {
    // Set OpenGL version hints
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, config_.openglMajor);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, config_.openglMinor);
    glfwWindowHint(GLFW_OPENGL_PROFILE, config_.openglCoreProfile ? GLFW_OPENGL_CORE_PROFILE : GLFW_OPENGL_COMPAT_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);

    // Set window hints
    glfwWindowHint(GLFW_RESIZABLE, config_.resizable ? GLFW_TRUE : GLFW_FALSE);
    glfwWindowHint(GLFW_DECORATED, config_.decorated ? GLFW_TRUE : GLFW_FALSE);
    glfwWindowHint(GLFW_SAMPLES, config_.msaaSamples);

    // Debug context
    if (config_.openglDebugContext) {
        glfwWindowHint(GLFW_OPENGL_DEBUG_CONTEXT, GLFW_TRUE);
    }

    // Get monitor for fullscreen
    monitor_ = config_.fullscreen ? glfwGetPrimaryMonitor() : nullptr;

    // Create window
    window_ = glfwCreateWindow(
        config_.width,
        config_.height,
        config_.title.c_str(),
        monitor_,
        nullptr
    );

    if (!window_) {
        std::cerr << "[Window] Failed to create GLFW window" << std::endl;
        return false;
    }

    // Store window pointer for callbacks
    glfwSetWindowUserPointer(window_, this);

    fullscreen_ = config_.fullscreen;
    windowedWidth_ = config_.width;
    windowedHeight_ = config_.height;

    return true;
}

bool Window::createOpenGLContext() {
    // Make context current
    glfwMakeContextCurrent(window_);

    // Load OpenGL functions (this would use GLAD in production)
    // For now, we'll just verify the context was created
    std::cout << "[Window] OpenGL context created" << std::endl;

    // Print OpenGL version info
    const char* version = (const char*)glGetString(GL_VERSION);
    const char* vendor = (const char*)glGetString(GL_VENDOR);
    const char* renderer = (const char*)glGetString(GL_RENDERER);

    if (version) {
        std::cout << "[Window] OpenGL Version: " << version << std::endl;
        std::cout << "[Window] OpenGL Vendor: " << vendor << std::endl;
        std::cout << "[Window] OpenGL Renderer: " << renderer << std::endl;
    }

    // Enable MSAA if requested
    if (config_.msaaSamples > 1) {
        glEnable(GL_MULTISAMPLE);
    }

    return true;
}

void Window::setupCallbacks() {
    glfwSetKeyCallback(window_, keyCallback);
    glfwSetCursorPosCallback(window_, cursorPosCallback);
    glfwSetMouseButtonCallback(window_, mouseButtonCallback);
    glfwSetScrollCallback(window_, scrollCallback);
    glfwSetFramebufferSizeCallback(window_, framebufferSizeCallback);
    glfwSetWindowCloseCallback(window_, windowCloseCallback);
}

bool Window::shouldClose() const {
    return window_ ? glfwWindowShouldClose(window_) : true;
}

void Window::pollEvents() {
    glfwPollEvents();
}

void Window::swapBuffers() {
    if (window_) {
        glfwSwapBuffers(window_);
    }
}

void Window::getSize(uint32_t& width, uint32_t& height) const {
    int w, h;
    glfwGetWindowSize(window_, &w, &h);
    width = static_cast<uint32_t>(w);
    height = static_cast<uint32_t>(h);
}

void Window::getFramebufferSize(uint32_t& width, uint32_t& height) const {
    int w, h;
    glfwGetFramebufferSize(window_, &w, &h);
    width = static_cast<uint32_t>(w);
    height = static_cast<uint32_t>(h);
}

void Window::setTitle(const std::string& title) {
    if (window_) {
        glfwSetWindowTitle(window_, title.c_str());
    }
}

void Window::setVSync(bool enabled) {
    vsync_ = enabled;
    glfwSwapInterval(enabled ? 1 : 0);
}

void Window::setFullscreen(bool enabled) {
    if (fullscreen_ == enabled || !window_) {
        return;
    }

    if (enabled) {
        // Save windowed position and size
        glfwGetWindowPos(window_, &windowedPosX_, &windowedPosY_);
        glfwGetWindowSize(window_, (int*)&windowedWidth_, (int*)&windowedHeight_);

        // Get primary monitor video mode
        GLFWmonitor* monitor = glfwGetPrimaryMonitor();
        const GLFWvidmode* mode = glfwGetVideoMode(monitor);

        // Switch to fullscreen
        glfwSetWindowMonitor(window_, monitor, 0, 0, mode->width, mode->height, mode->refreshRate);
    } else {
        // Restore windowed mode
        glfwSetWindowMonitor(window_, nullptr, windowedPosX_, windowedPosY_,
                            windowedWidth_, windowedHeight_, GLFW_DONT_CARE);
    }

    fullscreen_ = enabled;
}

void Window::setCursorVisible(bool visible) {
    if (window_) {
        glfwSetInputMode(window_, GLFW_CURSOR, visible ? GLFW_CURSOR_NORMAL : GLFW_CURSOR_HIDDEN);
    }
}

void Window::setCursorPosition(double x, double y) {
    if (window_) {
        glfwSetCursorPos(window_, x, y);
    }
}

double Window::getTime() const {
    return glfwGetTime();
}

float Window::getAspectRatio() const {
    uint32_t width, height;
    getSize(width, height);
    return height > 0 ? static_cast<float>(width) / static_cast<float>(height) : 1.0f;
}

bool Window::isKeyPressed(int key) const {
    if (!window_) return false;
    return glfwGetKey(window_, key) == GLFW_PRESS;
}

bool Window::isMouseButtonPressed(int button) const {
    if (!window_) return false;
    return glfwGetMouseButton(window_, button) == GLFW_PRESS;
}

void Window::getMousePosition(double& x, double& y) const {
    if (window_) {
        glfwGetCursorPos(window_, &x, &y);
    }
}

void Window::setInputCallbacks(const InputCallbacks& callbacks) {
    callbacks_ = callbacks;
}

int Window::getMonitorCount() {
    int count;
    glfwGetMonitors(&count);
    return count;
}

void Window::getMonitorWorkArea(int monitorIndex, int& x, int& y, int& width, int& height) {
    int count;
    GLFWmonitor** monitors = glfwGetMonitors(&count);
    if (monitorIndex >= 0 && monitorIndex < count) {
        glfwGetMonitorWorkarea(monitors[monitorIndex], &x, &y, &width, &height);
    }
}

// Static GLFW Callbacks

void Window::errorCallback(int error, const char* description) {
    std::cerr << "[GLFW Error " << error << "] " << description << std::endl;
}

void Window::keyCallback(GLFWwindow* window, int key, int scancode, int action, int mods) {
    Window* win = static_cast<Window*>(glfwGetWindowUserPointer(window));
    if (win && win->callbacks_.onKey) {
        win->callbacks_.onKey(key, scancode, action, mods);
    }
}

void Window::cursorPosCallback(GLFWwindow* window, double xpos, double ypos) {
    Window* win = static_cast<Window*>(glfwGetWindowUserPointer(window));
    if (win && win->callbacks_.onMouseMove) {
        win->callbacks_.onMouseMove(xpos, ypos);
    }
}

void Window::mouseButtonCallback(GLFWwindow* window, int button, int action, int mods) {
    Window* win = static_cast<Window*>(glfwGetWindowUserPointer(window));
    if (win && win->callbacks_.onMouseButton) {
        win->callbacks_.onMouseButton(button, action, mods);
    }
}

void Window::scrollCallback(GLFWwindow* window, double xoffset, double yoffset) {
    Window* win = static_cast<Window*>(glfwGetWindowUserPointer(window));
    if (win && win->callbacks_.onMouseScroll) {
        win->callbacks_.onMouseScroll(xoffset, yoffset);
    }
}

void Window::framebufferSizeCallback(GLFWwindow* window, int width, int height) {
    Window* win = static_cast<Window*>(glfwGetWindowUserPointer(window));
    if (win && win->callbacks_.onResize) {
        win->callbacks_.onResize(static_cast<uint32_t>(width), static_cast<uint32_t>(height));
    }
}

void Window::windowCloseCallback(GLFWwindow* window) {
    Window* win = static_cast<Window*>(glfwGetWindowUserPointer(window));
    if (win && win->callbacks_.onClose) {
        win->callbacks_.onClose();
    }
}

} // namespace tilt
