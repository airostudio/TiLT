/*
 * OpenGL Shader System Implementation
 */

#include "gl_shader.hpp"
#include <glad/glad.h>
#include <iostream>
#include <fstream>
#include <sstream>
#include <glm/gtc/type_ptr.hpp>

namespace tilt {

Shader::Shader()
    : programId_(0)
{
}

Shader::~Shader() {
    destroy();
}

bool Shader::createFromSource(const std::string& vertexSrc, const std::string& fragmentSrc) {
    // Compile shaders
    uint32_t vertexShader = compileShader(ShaderType::Vertex, vertexSrc);
    uint32_t fragmentShader = compileShader(ShaderType::Fragment, fragmentSrc);

    if (vertexShader == 0 || fragmentShader == 0) {
        if (vertexShader) glDeleteShader(vertexShader);
        if (fragmentShader) glDeleteShader(fragmentShader);
        return false;
    }

    // Link program
    std::vector<uint32_t> shaders = {vertexShader, fragmentShader};
    bool success = linkProgram(shaders);

    // Cleanup shaders (no longer needed after linking)
    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);

    return success;
}

bool Shader::createFromSource(const std::string& vertexSrc, const std::string& fragmentSrc, const std::string& geometrySrc) {
    // Compile shaders
    uint32_t vertexShader = compileShader(ShaderType::Vertex, vertexSrc);
    uint32_t fragmentShader = compileShader(ShaderType::Fragment, fragmentSrc);
    uint32_t geometryShader = compileShader(ShaderType::Geometry, geometrySrc);

    if (vertexShader == 0 || fragmentShader == 0 || geometryShader == 0) {
        if (vertexShader) glDeleteShader(vertexShader);
        if (fragmentShader) glDeleteShader(fragmentShader);
        if (geometryShader) glDeleteShader(geometryShader);
        return false;
    }

    // Link program
    std::vector<uint32_t> shaders = {vertexShader, fragmentShader, geometryShader};
    bool success = linkProgram(shaders);

    // Cleanup
    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);
    glDeleteShader(geometryShader);

    return success;
}

bool Shader::loadFromFile(const std::string& vertexPath, const std::string& fragmentPath) {
    // Read vertex shader
    std::ifstream vShaderFile(vertexPath);
    if (!vShaderFile.is_open()) {
        std::cerr << "[Shader] Failed to open vertex shader: " << vertexPath << std::endl;
        return false;
    }
    std::stringstream vShaderStream;
    vShaderStream << vShaderFile.rdbuf();
    std::string vertexSrc = vShaderStream.str();

    // Read fragment shader
    std::ifstream fShaderFile(fragmentPath);
    if (!fShaderFile.is_open()) {
        std::cerr << "[Shader] Failed to open fragment shader: " << fragmentPath << std::endl;
        return false;
    }
    std::stringstream fShaderStream;
    fShaderStream << fShaderFile.rdbuf();
    std::string fragmentSrc = fShaderStream.str();

    return createFromSource(vertexSrc, fragmentSrc);
}

bool Shader::loadFromFile(const std::string& vertexPath, const std::string& fragmentPath, const std::string& geometryPath) {
    // Read all shaders
    std::ifstream vShaderFile(vertexPath);
    std::ifstream fShaderFile(fragmentPath);
    std::ifstream gShaderFile(geometryPath);

    if (!vShaderFile.is_open() || !fShaderFile.is_open() || !gShaderFile.is_open()) {
        std::cerr << "[Shader] Failed to open shader files" << std::endl;
        return false;
    }

    std::stringstream vStream, fStream, gStream;
    vStream << vShaderFile.rdbuf();
    fStream << fShaderFile.rdbuf();
    gStream << gShaderFile.rdbuf();

    return createFromSource(vStream.str(), fStream.str(), gStream.str());
}

uint32_t Shader::compileShader(ShaderType type, const std::string& source) {
    // Map shader type to OpenGL enum
    GLenum glType;
    const char* typeName;

    switch (type) {
        case ShaderType::Vertex:
            glType = GL_VERTEX_SHADER;
            typeName = "Vertex";
            break;
        case ShaderType::Fragment:
            glType = GL_FRAGMENT_SHADER;
            typeName = "Fragment";
            break;
        case ShaderType::Geometry:
            glType = GL_GEOMETRY_SHADER;
            typeName = "Geometry";
            break;
        case ShaderType::Compute:
            glType = GL_COMPUTE_SHADER;
            typeName = "Compute";
            break;
        case ShaderType::TessControl:
            glType = GL_TESS_CONTROL_SHADER;
            typeName = "TessControl";
            break;
        case ShaderType::TessEvaluation:
            glType = GL_TESS_EVALUATION_SHADER;
            typeName = "TessEvaluation";
            break;
        default:
            std::cerr << "[Shader] Unknown shader type" << std::endl;
            return 0;
    }

    // Create and compile shader
    uint32_t shader = glCreateShader(glType);
    const char* sourceCStr = source.c_str();
    glShaderSource(shader, 1, &sourceCStr, nullptr);
    glCompileShader(shader);

    // Check compilation
    if (!checkCompileErrors(shader, type)) {
        glDeleteShader(shader);
        return 0;
    }

    std::cout << "[Shader] " << typeName << " shader compiled successfully" << std::endl;
    return shader;
}

bool Shader::linkProgram(const std::vector<uint32_t>& shaderIds) {
    // Create program
    programId_ = glCreateProgram();

    // Attach shaders
    for (uint32_t shader : shaderIds) {
        glAttachShader(programId_, shader);
    }

    // Link program
    glLinkProgram(programId_);

    // Check linking
    if (!checkLinkErrors(programId_)) {
        glDeleteProgram(programId_);
        programId_ = 0;
        return false;
    }

    std::cout << "[Shader] Program linked successfully (ID: " << programId_ << ")" << std::endl;
    return true;
}

bool Shader::checkCompileErrors(uint32_t shader, ShaderType type) {
    int success;
    char infoLog[1024];

    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
    if (!success) {
        glGetShaderInfoLog(shader, 1024, nullptr, infoLog);
        std::cerr << "[Shader] Compilation failed:\n" << infoLog << std::endl;
        return false;
    }

    return true;
}

bool Shader::checkLinkErrors(uint32_t program) {
    int success;
    char infoLog[1024];

    glGetProgramiv(program, GL_LINK_STATUS, &success);
    if (!success) {
        glGetProgramInfoLog(program, 1024, nullptr, infoLog);
        std::cerr << "[Shader] Linking failed:\n" << infoLog << std::endl;
        return false;
    }

    return true;
}

void Shader::bind() const {
    if (programId_) {
        glUseProgram(programId_);
    }
}

void Shader::unbind() const {
    glUseProgram(0);
}

int Shader::getUniformLocation(const std::string& name) {
    // Check cache first
    auto it = uniformCache_.find(name);
    if (it != uniformCache_.end()) {
        return it->second;
    }

    // Query location and cache it
    int location = glGetUniformLocation(programId_, name.c_str());
    uniformCache_[name] = location;

    if (location == -1) {
        std::cerr << "[Shader] Uniform '" << name << "' not found" << std::endl;
    }

    return location;
}

void Shader::setUniform(const std::string& name, int value) {
    glUniform1i(getUniformLocation(name), value);
}

void Shader::setUniform(const std::string& name, float value) {
    glUniform1f(getUniformLocation(name), value);
}

void Shader::setUniform(const std::string& name, const glm::vec2& value) {
    glUniform2fv(getUniformLocation(name), 1, glm::value_ptr(value));
}

void Shader::setUniform(const std::string& name, const glm::vec3& value) {
    glUniform3fv(getUniformLocation(name), 1, glm::value_ptr(value));
}

void Shader::setUniform(const std::string& name, const glm::vec4& value) {
    glUniform4fv(getUniformLocation(name), 1, glm::value_ptr(value));
}

void Shader::setUniform(const std::string& name, const glm::mat3& value) {
    glUniformMatrix3fv(getUniformLocation(name), 1, GL_FALSE, glm::value_ptr(value));
}

void Shader::setUniform(const std::string& name, const glm::mat4& value) {
    glUniformMatrix4fv(getUniformLocation(name), 1, GL_FALSE, glm::value_ptr(value));
}

void Shader::setUniform(const std::string& name, const std::vector<glm::mat4>& values) {
    if (!values.empty()) {
        glUniformMatrix4fv(getUniformLocation(name), values.size(), GL_FALSE, glm::value_ptr(values[0]));
    }
}

void Shader::setTexture(const std::string& name, uint32_t textureId, uint32_t slot) {
    glActiveTexture(GL_TEXTURE0 + slot);
    glBindTexture(GL_TEXTURE_2D, textureId);
    setUniform(name, static_cast<int>(slot));
}

void Shader::destroy() {
    if (programId_) {
        glDeleteProgram(programId_);
        programId_ = 0;
    }
    uniformCache_.clear();
}

// ShaderLibrary Implementation

void ShaderLibrary::add(const std::string& name, Shader* shader) {
    if (exists(name)) {
        std::cerr << "[ShaderLibrary] Shader '" << name << "' already exists" << std::endl;
        return;
    }
    shaders_[name] = shader;
}

Shader* ShaderLibrary::load(const std::string& name, const std::string& vertexPath, const std::string& fragmentPath) {
    if (exists(name)) {
        return shaders_[name];
    }

    Shader* shader = new Shader();
    if (shader->loadFromFile(vertexPath, fragmentPath)) {
        shaders_[name] = shader;
        return shader;
    }

    delete shader;
    return nullptr;
}

Shader* ShaderLibrary::load(const std::string& name, const std::string& vertexPath, const std::string& fragmentPath, const std::string& geometryPath) {
    if (exists(name)) {
        return shaders_[name];
    }

    Shader* shader = new Shader();
    if (shader->loadFromFile(vertexPath, fragmentPath, geometryPath)) {
        shaders_[name] = shader;
        return shader;
    }

    delete shader;
    return nullptr;
}

Shader* ShaderLibrary::get(const std::string& name) {
    auto it = shaders_.find(name);
    if (it != shaders_.end()) {
        return it->second;
    }
    return nullptr;
}

bool ShaderLibrary::exists(const std::string& name) const {
    return shaders_.find(name) != shaders_.end();
}

void ShaderLibrary::clear() {
    for (auto& pair : shaders_) {
        delete pair.second;
    }
    shaders_.clear();
}

// Built-in Shader Sources

namespace BuiltInShaders {

const char* SimpleVertex = R"(
#version 460 core

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

out vec4 vColor;

void main() {
    gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
    vColor = aColor;
}
)";

const char* SimpleFragment = R"(
#version 460 core

in vec4 vColor;
out vec4 FragColor;

void main() {
    FragColor = vColor;
}
)";

const char* StandardVertex = R"(
#version 460 core

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uNormalMatrix;

out vec3 vPosition;
out vec3 vNormal;
out vec2 vTexCoord;

void main() {
    vec4 worldPos = uModel * vec4(aPosition, 1.0);
    gl_Position = uProjection * uView * worldPos;

    vPosition = worldPos.xyz;
    vNormal = mat3(uNormalMatrix) * aNormal;
    vTexCoord = aTexCoord;
}
)";

const char* StandardFragment = R"(
#version 460 core

in vec3 vPosition;
in vec3 vNormal;
in vec2 vTexCoord;

uniform sampler2D uTexture;
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform vec4 uColor;

out vec4 FragColor;

void main() {
    // Sample texture
    vec4 texColor = texture(uTexture, vTexCoord);

    // Simple Phong lighting
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(uLightPos - vPosition);
    vec3 viewDir = normalize(uViewPos - vPosition);
    vec3 reflectDir = reflect(-lightDir, normal);

    // Ambient
    float ambientStrength = 0.3;
    vec3 ambient = ambientStrength * texColor.rgb;

    // Diffuse
    float diff = max(dot(normal, lightDir), 0.0);
    vec3 diffuse = diff * texColor.rgb;

    // Specular
    float specularStrength = 0.5;
    float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
    vec3 specular = specularStrength * spec * vec3(1.0);

    vec3 result = ambient + diffuse + specular;
    FragColor = vec4(result, texColor.a) * uColor;
}
)";

const char* DMDVertex = R"(
#version 460 core

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aTexCoord;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

out vec2 vTexCoord;

void main() {
    gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
    vTexCoord = aTexCoord;
}
)";

const char* DMDFragment = R"(
#version 460 core

in vec2 vTexCoord;

uniform sampler2D uDMDTexture;
uniform vec4 uColor;
uniform float uBrightness;

out vec4 FragColor;

void main() {
    float intensity = texture(uDMDTexture, vTexCoord).r;
    vec3 color = uColor.rgb * intensity * uBrightness;
    FragColor = vec4(color, 1.0);
}
)";

const char* BackglassVertex = R"(
#version 460 core

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aTexCoord;

uniform mat4 uProjection;
uniform mat4 uModel;

out vec2 vTexCoord;

void main() {
    gl_Position = uProjection * uModel * vec4(aPosition, 1.0);
    vTexCoord = aTexCoord;
}
)";

const char* BackglassFragment = R"(
#version 460 core

in vec2 vTexCoord;

uniform sampler2D uBackglassTexture;
uniform float uAlpha;

out vec4 FragColor;

void main() {
    vec4 texColor = texture(uBackglassTexture, vTexCoord);
    FragColor = vec4(texColor.rgb, texColor.a * uAlpha);
}
)";

} // namespace BuiltInShaders

} // namespace tilt
