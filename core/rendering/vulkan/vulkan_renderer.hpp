/*
 * Vulkan Renderer
 */

#ifndef TILT_RENDERING_VULKAN_RENDERER_HPP
#define TILT_RENDERING_VULKAN_RENDERER_HPP

#include "../renderer.hpp"

namespace tilt {

class VulkanRenderer : public Renderer {
public:
    VulkanRenderer();
    ~VulkanRenderer() override;

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

#endif // TILT_RENDERING_VULKAN_RENDERER_HPP
