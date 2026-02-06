/*
 * OpenGL Mesh Rendering System
 * Vertex buffers, index buffers, and mesh rendering
 */

#pragma once

#include <vector>
#include <cstdint>
#include <glm/glm.hpp>

namespace tilt {

/**
 * Vertex structure with position, normal, and UV
 */
struct Vertex {
    glm::vec3 position;
    glm::vec3 normal;
    glm::vec2 texCoord;

    Vertex() : position(0.0f), normal(0.0f, 1.0f, 0.0f), texCoord(0.0f) {}
    Vertex(const glm::vec3& pos, const glm::vec3& norm, const glm::vec2& uv)
        : position(pos), normal(norm), texCoord(uv) {}
};

/**
 * Mesh class
 * Manages vertex and index buffers for rendering
 */
class Mesh {
public:
    Mesh();
    ~Mesh();

    // Disable copy
    Mesh(const Mesh&) = delete;
    Mesh& operator=(const Mesh&) = delete;

    /**
     * Create mesh from vertices and indices
     */
    bool create(const std::vector<Vertex>& vertices, const std::vector<uint32_t>& indices);

    /**
     * Update mesh data
     */
    void updateVertices(const std::vector<Vertex>& vertices);
    void updateIndices(const std::vector<uint32_t>& indices);

    /**
     * Draw mesh
     */
    void draw() const;

    /**
     * Get properties
     */
    uint32_t getVertexCount() const { return vertexCount_; }
    uint32_t getIndexCount() const { return indexCount_; }
    bool isValid() const { return vao_ != 0; }

    /**
     * Cleanup
     */
    void destroy();

    // Static factory methods for common shapes
    static Mesh* createCube(float size = 1.0f);
    static Mesh* createPlane(float width = 1.0f, float height = 1.0f, uint32_t subdivisionsX = 1, uint32_t subdivisionsY = 1);
    static Mesh* createSphere(float radius = 1.0f, uint32_t segments = 32, uint32_t rings = 16);

private:
    uint32_t vao_;  // Vertex Array Object
    uint32_t vbo_;  // Vertex Buffer Object
    uint32_t ebo_;  // Element Buffer Object (indices)

    uint32_t vertexCount_;
    uint32_t indexCount_;

    void setupBuffers(const std::vector<Vertex>& vertices, const std::vector<uint32_t>& indices);
};

/**
 * Camera class
 * Perspective and orthographic projection with FPS-style controls
 */
class Camera {
public:
    Camera();

    /**
     * Set camera projection
     */
    void setPerspective(float fov, float aspect, float near, float far);
    void setOrthographic(float left, float right, float bottom, float top, float near, float far);

    /**
     * Set camera transform
     */
    void setPosition(const glm::vec3& position);
    void setRotation(float yaw, float pitch);
    void lookAt(const glm::vec3& target, const glm::vec3& up = glm::vec3(0, 1, 0));

    /**
     * Move camera
     */
    void move(const glm::vec3& offset);
    void rotate(float yawOffset, float pitchOffset);

    /**
     * Get matrices
     */
    const glm::mat4& getViewMatrix() const { return viewMatrix_; }
    const glm::mat4& getProjectionMatrix() const { return projectionMatrix_; }
    glm::mat4 getViewProjectionMatrix() const { return projectionMatrix_ * viewMatrix_; }

    /**
     * Get camera properties
     */
    const glm::vec3& getPosition() const { return position_; }
    glm::vec3 getForward() const { return forward_; }
    glm::vec3 getRight() const { return right_; }
    glm::vec3 getUp() const { return up_; }

private:
    glm::vec3 position_;
    float yaw_;
    float pitch_;

    glm::vec3 forward_;
    glm::vec3 right_;
    glm::vec3 up_;

    glm::mat4 viewMatrix_;
    glm::mat4 projectionMatrix_;

    void updateVectors();
    void updateViewMatrix();
};

} // namespace tilt
