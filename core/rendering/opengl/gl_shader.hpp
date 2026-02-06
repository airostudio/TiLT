/*
 * OpenGL Shader System
 * Shader compilation, linking, and uniform management
 */

#pragma once

#include <string>
#include <unordered_map>
#include <cstdint>
#include <vector>

// GLM for math types
#include <glm/glm.hpp>

namespace tilt {

/**
 * Shader type enumeration
 */
enum class ShaderType {
    Vertex,
    Fragment,
    Geometry,
    Compute,
    TessControl,
    TessEvaluation
};

/**
 * Shader Program
 * Manages OpenGL shader programs with automatic uniform caching
 */
class Shader {
public:
    Shader();
    ~Shader();

    // Disable copy
    Shader(const Shader&) = delete;
    Shader& operator=(const Shader&) = delete;

    /**
     * Create shader from source strings
     */
    bool createFromSource(const std::string& vertexSrc, const std::string& fragmentSrc);
    bool createFromSource(const std::string& vertexSrc, const std::string& fragmentSrc, const std::string& geometrySrc);

    /**
     * Load shader from files
     */
    bool loadFromFile(const std::string& vertexPath, const std::string& fragmentPath);
    bool loadFromFile(const std::string& vertexPath, const std::string& fragmentPath, const std::string& geometryPath);

    /**
     * Bind/unbind shader for use
     */
    void bind() const;
    void unbind() const;

    /**
     * Check if shader is valid
     */
    bool isValid() const { return programId_ != 0; }

    /**
     * Get native OpenGL program ID
     */
    uint32_t getProgramId() const { return programId_; }

    /**
     * Set uniform values
     */
    void setUniform(const std::string& name, int value);
    void setUniform(const std::string& name, float value);
    void setUniform(const std::string& name, const glm::vec2& value);
    void setUniform(const std::string& name, const glm::vec3& value);
    void setUniform(const std::string& name, const glm::vec4& value);
    void setUniform(const std::string& name, const glm::mat3& value);
    void setUniform(const std::string& name, const glm::mat4& value);
    void setUniform(const std::string& name, const std::vector<glm::mat4>& values);

    /**
     * Set sampler uniforms
     */
    void setTexture(const std::string& name, uint32_t textureId, uint32_t slot);

    /**
     * Cleanup
     */
    void destroy();

private:
    uint32_t programId_;
    std::unordered_map<std::string, int> uniformCache_;

    // Compile individual shader
    uint32_t compileShader(ShaderType type, const std::string& source);

    // Link shader program
    bool linkProgram(const std::vector<uint32_t>& shaderIds);

    // Get uniform location (with caching)
    int getUniformLocation(const std::string& name);

    // Error checking
    bool checkCompileErrors(uint32_t shader, ShaderType type);
    bool checkLinkErrors(uint32_t program);
};

/**
 * Shader Library
 * Manages multiple shaders with named access
 */
class ShaderLibrary {
public:
    ShaderLibrary() = default;
    ~ShaderLibrary() = default;

    /**
     * Add shader to library
     */
    void add(const std::string& name, Shader* shader);

    /**
     * Load shader from file and add to library
     */
    Shader* load(const std::string& name, const std::string& vertexPath, const std::string& fragmentPath);
    Shader* load(const std::string& name, const std::string& vertexPath, const std::string& fragmentPath, const std::string& geometryPath);

    /**
     * Get shader by name
     */
    Shader* get(const std::string& name);

    /**
     * Check if shader exists
     */
    bool exists(const std::string& name) const;

    /**
     * Clear all shaders
     */
    void clear();

private:
    std::unordered_map<std::string, Shader*> shaders_;
};

/**
 * Common shader sources for built-in shaders
 */
namespace BuiltInShaders {

    // Simple unlit color shader
    extern const char* SimpleVertex;
    extern const char* SimpleFragment;

    // Textured shader with lighting
    extern const char* StandardVertex;
    extern const char* StandardFragment;

    // DMD shader
    extern const char* DMDVertex;
    extern const char* DMDFragment;

    // Backglass shader
    extern const char* BackglassVertex;
    extern const char* BackglassFragment;
}

} // namespace tilt
