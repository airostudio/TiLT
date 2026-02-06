/*
 * Window Management System
 * GLFW-based window creation and input handling
 */

#pragma once

#include <string>
#include <functional>
#include <memory>
#include <cstdint>

// Forward declare GLFW types to avoid header pollution
struct GLFWwindow;
struct GLFWmonitor;

namespace tilt {

/**
 * Window configuration
 */
struct WindowConfig {
    std::string title = "TiLT - Totally Integrated Luxurious Tables";
    uint32_t width = 1920;
    uint32_t height = 1080;
    bool fullscreen = false;
    bool vsync = true;
    bool resizable = true;
    bool decorated = true;
    uint32_t msaaSamples = 4;
    int openglMajor = 4;
    int openglMinor = 6;
    bool openglCoreProfile = true;
    bool openglDebugContext = false;
};

/**
 * Input event callbacks
 */
struct InputCallbacks {
    std::function<void(int key, int scancode, int action, int mods)> onKey;
    std::function<void(double xpos, double ypos)> onMouseMove;
    std::function<void(int button, int action, int mods)> onMouseButton;
    std::function<void(double xoffset, double yoffset)> onMouseScroll;
    std::function<void(uint32_t width, uint32_t height)> onResize;
    std::function<void()> onClose;
};

/**
 * Window Management Class
 * Handles window creation, input, and OpenGL context
 */
class Window {
public:
    Window();
    ~Window();

    // Disable copy
    Window(const Window&) = delete;
    Window& operator=(const Window&) = delete;

    /**
     * Initialize window with configuration
     */
    bool initialize(const WindowConfig& config);

    /**
     * Shutdown and destroy window
     */
    void shutdown();

    /**
     * Check if window should close
     */
    bool shouldClose() const;

    /**
     * Poll input events
     */
    void pollEvents();

    /**
     * Swap front and back buffers
     */
    void swapBuffers();

    /**
     * Get window dimensions
     */
    void getSize(uint32_t& width, uint32_t& height) const;
    void getFramebufferSize(uint32_t& width, uint32_t& height) const;

    /**
     * Set window properties
     */
    void setTitle(const std::string& title);
    void setVSync(bool enabled);
    void setFullscreen(bool enabled);
    void setCursorVisible(bool visible);
    void setCursorPosition(double x, double y);

    /**
     * Get window properties
     */
    bool isFullscreen() const { return fullscreen_; }
    bool isVSyncEnabled() const { return vsync_; }
    double getTime() const;
    float getAspectRatio() const;

    /**
     * Input state queries
     */
    bool isKeyPressed(int key) const;
    bool isMouseButtonPressed(int button) const;
    void getMousePosition(double& x, double& y) const;

    /**
     * Set input callbacks
     */
    void setInputCallbacks(const InputCallbacks& callbacks);

    /**
     * Get native GLFW window handle
     */
    GLFWwindow* getNativeHandle() const { return window_; }

    /**
     * Get monitor information
     */
    static int getMonitorCount();
    static void getMonitorWorkArea(int monitorIndex, int& x, int& y, int& width, int& height);

private:
    GLFWwindow* window_;
    GLFWmonitor* monitor_;

    WindowConfig config_;
    InputCallbacks callbacks_;

    bool initialized_;
    bool fullscreen_;
    bool vsync_;

    uint32_t windowedWidth_;
    uint32_t windowedHeight_;
    int windowedPosX_;
    int windowedPosY_;

    // GLFW callbacks (static)
    static void errorCallback(int error, const char* description);
    static void keyCallback(GLFWwindow* window, int key, int scancode, int action, int mods);
    static void cursorPosCallback(GLFWwindow* window, double xpos, double ypos);
    static void mouseButtonCallback(GLFWwindow* window, int button, int action, int mods);
    static void scrollCallback(GLFWwindow* window, double xoffset, double yoffset);
    static void framebufferSizeCallback(GLFWwindow* window, int width, int height);
    static void windowCloseCallback(GLFWwindow* window);

    bool createWindow();
    bool createOpenGLContext();
    void setupCallbacks();
};

} // namespace tilt
