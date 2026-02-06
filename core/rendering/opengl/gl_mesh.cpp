/*
 * OpenGL Mesh and Camera Implementation
 */

#include "gl_mesh.hpp"
#include <glad/glad.h>
#include <glm/gtc/matrix_transform.hpp>
#include <iostream>
#include <cmath>

namespace tilt {

// Mesh Implementation

Mesh::Mesh()
    : vao_(0), vbo_(0), ebo_(0)
    , vertexCount_(0), indexCount_(0)
{
}

Mesh::~Mesh() {
    destroy();
}

bool Mesh::create(const std::vector<Vertex>& vertices, const std::vector<uint32_t>& indices) {
    if (vertices.empty()) {
        std::cerr << "[Mesh] Cannot create mesh with no vertices" << std::endl;
        return false;
    }

    setupBuffers(vertices, indices);
    return true;
}

void Mesh::setupBuffers(const std::vector<Vertex>& vertices, const std::vector<uint32_t>& indices) {
    // Destroy existing buffers
    if (vao_) {
        destroy();
    }

    vertexCount_ = vertices.size();
    indexCount_ = indices.size();

    // Create VAO
    glGenVertexArrays(1, &vao_);
    glBindVertexArray(vao_);

    // Create VBO
    glGenBuffers(1, &vbo_);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(), GL_STATIC_DRAW);

    // Position attribute
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, position));

    // Normal attribute
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, normal));

    // TexCoord attribute
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, texCoord));

    // Create EBO if indices provided
    if (!indices.empty()) {
        glGenBuffers(1, &ebo_);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo_);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices.size() * sizeof(uint32_t), indices.data(), GL_STATIC_DRAW);
    }

    glBindVertexArray(0);
}

void Mesh::updateVertices(const std::vector<Vertex>& vertices) {
    if (vbo_ == 0) return;

    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(), GL_STATIC_DRAW);
    glBindBuffer(GL_ARRAY_BUFFER, 0);

    vertexCount_ = vertices.size();
}

void Mesh::updateIndices(const std::vector<uint32_t>& indices) {
    if (ebo_ == 0) return;

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices.size() * sizeof(uint32_t), indices.data(), GL_STATIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);

    indexCount_ = indices.size();
}

void Mesh::draw() const {
    if (vao_ == 0) return;

    glBindVertexArray(vao_);

    if (indexCount_ > 0) {
        glDrawElements(GL_TRIANGLES, indexCount_, GL_UNSIGNED_INT, 0);
    } else {
        glDrawArrays(GL_TRIANGLES, 0, vertexCount_);
    }

    glBindVertexArray(0);
}

void Mesh::destroy() {
    if (vao_) glDeleteVertexArrays(1, &vao_);
    if (vbo_) glDeleteBuffers(1, &vbo_);
    if (ebo_) glDeleteBuffers(1, &ebo_);

    vao_ = vbo_ = ebo_ = 0;
    vertexCount_ = indexCount_ = 0;
}

// Factory methods

Mesh* Mesh::createCube(float size) {
    float hs = size * 0.5f; // half size

    std::vector<Vertex> vertices = {
        // Front face
        {{-hs, -hs,  hs}, { 0,  0,  1}, {0, 0}},
        {{ hs, -hs,  hs}, { 0,  0,  1}, {1, 0}},
        {{ hs,  hs,  hs}, { 0,  0,  1}, {1, 1}},
        {{-hs,  hs,  hs}, { 0,  0,  1}, {0, 1}},
        // Back face
        {{ hs, -hs, -hs}, { 0,  0, -1}, {0, 0}},
        {{-hs, -hs, -hs}, { 0,  0, -1}, {1, 0}},
        {{-hs,  hs, -hs}, { 0,  0, -1}, {1, 1}},
        {{ hs,  hs, -hs}, { 0,  0, -1}, {0, 1}},
        // Right face
        {{ hs, -hs,  hs}, { 1,  0,  0}, {0, 0}},
        {{ hs, -hs, -hs}, { 1,  0,  0}, {1, 0}},
        {{ hs,  hs, -hs}, { 1,  0,  0}, {1, 1}},
        {{ hs,  hs,  hs}, { 1,  0,  0}, {0, 1}},
        // Left face
        {{-hs, -hs, -hs}, {-1,  0,  0}, {0, 0}},
        {{-hs, -hs,  hs}, {-1,  0,  0}, {1, 0}},
        {{-hs,  hs,  hs}, {-1,  0,  0}, {1, 1}},
        {{-hs,  hs, -hs}, {-1,  0,  0}, {0, 1}},
        // Top face
        {{-hs,  hs,  hs}, { 0,  1,  0}, {0, 0}},
        {{ hs,  hs,  hs}, { 0,  1,  0}, {1, 0}},
        {{ hs,  hs, -hs}, { 0,  1,  0}, {1, 1}},
        {{-hs,  hs, -hs}, { 0,  1,  0}, {0, 1}},
        // Bottom face
        {{-hs, -hs, -hs}, { 0, -1,  0}, {0, 0}},
        {{ hs, -hs, -hs}, { 0, -1,  0}, {1, 0}},
        {{ hs, -hs,  hs}, { 0, -1,  0}, {1, 1}},
        {{-hs, -hs,  hs}, { 0, -1,  0}, {0, 1}},
    };

    std::vector<uint32_t> indices;
    for (uint32_t i = 0; i < 6; i++) {
        uint32_t base = i * 4;
        indices.push_back(base + 0);
        indices.push_back(base + 1);
        indices.push_back(base + 2);
        indices.push_back(base + 0);
        indices.push_back(base + 2);
        indices.push_back(base + 3);
    }

    Mesh* mesh = new Mesh();
    mesh->create(vertices, indices);
    return mesh;
}

Mesh* Mesh::createPlane(float width, float height, uint32_t subdivisionsX, uint32_t subdivisionsY) {
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;

    float hw = width * 0.5f;
    float hh = height * 0.5f;

    // Generate vertices
    for (uint32_t y = 0; y <= subdivisionsY; y++) {
        for (uint32_t x = 0; x <= subdivisionsX; x++) {
            float u = static_cast<float>(x) / subdivisionsX;
            float v = static_cast<float>(y) / subdivisionsY;

            Vertex vertex;
            vertex.position = glm::vec3(-hw + width * u, 0.0f, -hh + height * v);
            vertex.normal = glm::vec3(0.0f, 1.0f, 0.0f);
            vertex.texCoord = glm::vec2(u, v);

            vertices.push_back(vertex);
        }
    }

    // Generate indices
    for (uint32_t y = 0; y < subdivisionsY; y++) {
        for (uint32_t x = 0; x < subdivisionsX; x++) {
            uint32_t i0 = y * (subdivisionsX + 1) + x;
            uint32_t i1 = i0 + 1;
            uint32_t i2 = i0 + (subdivisionsX + 1);
            uint32_t i3 = i2 + 1;

            indices.push_back(i0);
            indices.push_back(i2);
            indices.push_back(i1);

            indices.push_back(i1);
            indices.push_back(i2);
            indices.push_back(i3);
        }
    }

    Mesh* mesh = new Mesh();
    mesh->create(vertices, indices);
    return mesh;
}

Mesh* Mesh::createSphere(float radius, uint32_t segments, uint32_t rings) {
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;

    const float PI = 3.14159265359f;

    // Generate vertices
    for (uint32_t ring = 0; ring <= rings; ring++) {
        float phi = PI * static_cast<float>(ring) / rings;
        for (uint32_t segment = 0; segment <= segments; segment++) {
            float theta = 2.0f * PI * static_cast<float>(segment) / segments;

            glm::vec3 position;
            position.x = radius * std::sin(phi) * std::cos(theta);
            position.y = radius * std::cos(phi);
            position.z = radius * std::sin(phi) * std::sin(theta);

            glm::vec3 normal = glm::normalize(position);

            glm::vec2 texCoord;
            texCoord.x = static_cast<float>(segment) / segments;
            texCoord.y = static_cast<float>(ring) / rings;

            vertices.push_back(Vertex(position, normal, texCoord));
        }
    }

    // Generate indices
    for (uint32_t ring = 0; ring < rings; ring++) {
        for (uint32_t segment = 0; segment < segments; segment++) {
            uint32_t i0 = ring * (segments + 1) + segment;
            uint32_t i1 = i0 + 1;
            uint32_t i2 = i0 + (segments + 1);
            uint32_t i3 = i2 + 1;

            indices.push_back(i0);
            indices.push_back(i2);
            indices.push_back(i1);

            indices.push_back(i1);
            indices.push_back(i2);
            indices.push_back(i3);
        }
    }

    Mesh* mesh = new Mesh();
    mesh->create(vertices, indices);
    return mesh;
}

// Camera Implementation

Camera::Camera()
    : position_(0.0f, 0.0f, 3.0f)
    , yaw_(-90.0f)
    , pitch_(0.0f)
    , forward_(0.0f, 0.0f, -1.0f)
    , right_(1.0f, 0.0f, 0.0f)
    , up_(0.0f, 1.0f, 0.0f)
    , viewMatrix_(1.0f)
    , projectionMatrix_(1.0f)
{
    updateVectors();
    updateViewMatrix();
}

void Camera::setPerspective(float fov, float aspect, float near, float far) {
    projectionMatrix_ = glm::perspective(glm::radians(fov), aspect, near, far);
}

void Camera::setOrthographic(float left, float right, float bottom, float top, float near, float far) {
    projectionMatrix_ = glm::ortho(left, right, bottom, top, near, far);
}

void Camera::setPosition(const glm::vec3& position) {
    position_ = position;
    updateViewMatrix();
}

void Camera::setRotation(float yaw, float pitch) {
    yaw_ = yaw;
    pitch_ = glm::clamp(pitch, -89.0f, 89.0f);
    updateVectors();
    updateViewMatrix();
}

void Camera::lookAt(const glm::vec3& target, const glm::vec3& up) {
    viewMatrix_ = glm::lookAt(position_, target, up);

    // Update direction vectors
    forward_ = glm::normalize(target - position_);
    right_ = glm::normalize(glm::cross(forward_, up));
    up_ = glm::normalize(glm::cross(right_, forward_));
}

void Camera::move(const glm::vec3& offset) {
    position_ += offset;
    updateViewMatrix();
}

void Camera::rotate(float yawOffset, float pitchOffset) {
    yaw_ += yawOffset;
    pitch_ += pitchOffset;
    pitch_ = glm::clamp(pitch_, -89.0f, 89.0f);
    updateVectors();
    updateViewMatrix();
}

void Camera::updateVectors() {
    glm::vec3 front;
    front.x = std::cos(glm::radians(yaw_)) * std::cos(glm::radians(pitch_));
    front.y = std::sin(glm::radians(pitch_));
    front.z = std::sin(glm::radians(yaw_)) * std::cos(glm::radians(pitch_));
    forward_ = glm::normalize(front);

    right_ = glm::normalize(glm::cross(forward_, glm::vec3(0.0f, 1.0f, 0.0f)));
    up_ = glm::normalize(glm::cross(right_, forward_));
}

void Camera::updateViewMatrix() {
    viewMatrix_ = glm::lookAt(position_, position_ + forward_, up_);
}

} // namespace tilt
