/*
 * OpenGL Texture System Implementation
 */

#include "gl_texture.hpp"
#include <glad/glad.h>
#include <iostream>

// stb_image for texture loading
#define STB_IMAGE_IMPLEMENTATION
#include <stb/stb_image.h>

namespace tilt {

Texture2D::Texture2D()
    : textureId_(0)
    , width_(0)
    , height_(0)
    , format_(TextureFormat::RGBA)
{
}

Texture2D::~Texture2D() {
    destroy();
}

bool Texture2D::loadFromFile(const std::string& path, const TextureConfig& config) {
    // Set stb_image flip flag
    stbi_set_flip_vertically_on_load(config.flipVertically);

    // Load image
    int width, height, channels;
    uint8_t* data = stbi_load(path.c_str(), &width, &height, &channels, 0);

    if (!data) {
        std::cerr << "[Texture] Failed to load: " << path << std::endl;
        std::cerr << "[Texture] Error: " << stbi_failure_reason() << std::endl;
        return false;
    }

    std::cout << "[Texture] Loaded: " << path << " (" << width << "x" << height
              << ", " << channels << " channels)" << std::endl;

    // Determine format based on channels
    TextureFormat format;
    switch (channels) {
        case 1:
            format = TextureFormat::Red;
            break;
        case 2:
            format = TextureFormat::RG;
            break;
        case 3:
            format = TextureFormat::RGB;
            break;
        case 4:
            format = TextureFormat::RGBA;
            break;
        default:
            std::cerr << "[Texture] Unsupported channel count: " << channels << std::endl;
            stbi_image_free(data);
            return false;
    }

    // Create texture
    bool success = createFromMemory(data, width, height, format, config);

    // Free image data
    stbi_image_free(data);

    return success;
}

bool Texture2D::createFromMemory(const uint8_t* data, uint32_t width, uint32_t height,
                                 TextureFormat format, const TextureConfig& config) {
    // Destroy existing texture
    if (textureId_) {
        destroy();
    }

    width_ = width;
    height_ = height;
    format_ = format;

    // Create OpenGL texture
    glGenTextures(1, &textureId_);
    glBindTexture(GL_TEXTURE_2D, textureId_);

    // Upload texture data
    GLenum glFormat = getGLFormat(format);
    GLenum glInternalFormat = getGLInternalFormat(format);

    glTexImage2D(GL_TEXTURE_2D, 0, glInternalFormat, width, height, 0,
                 glFormat, GL_UNSIGNED_BYTE, data);

    // Apply configuration
    applyConfig(config);

    // Generate mipmaps if requested
    if (config.generateMipmaps) {
        glGenerateMipmap(GL_TEXTURE_2D);
    }

    glBindTexture(GL_TEXTURE_2D, 0);

    std::cout << "[Texture] Created texture (ID: " << textureId_ << ")" << std::endl;
    return true;
}

bool Texture2D::createEmpty(uint32_t width, uint32_t height, TextureFormat format,
                            const TextureConfig& config) {
    // Destroy existing texture
    if (textureId_) {
        destroy();
    }

    width_ = width;
    height_ = height;
    format_ = format;

    // Create OpenGL texture
    glGenTextures(1, &textureId_);
    glBindTexture(GL_TEXTURE_2D, textureId_);

    // Allocate texture storage (no data)
    GLenum glFormat = getGLFormat(format);
    GLenum glInternalFormat = getGLInternalFormat(format);

    glTexImage2D(GL_TEXTURE_2D, 0, glInternalFormat, width, height, 0,
                 glFormat, GL_UNSIGNED_BYTE, nullptr);

    // Apply configuration
    applyConfig(config);

    glBindTexture(GL_TEXTURE_2D, 0);

    std::cout << "[Texture] Created empty texture (ID: " << textureId_ << ", "
              << width << "x" << height << ")" << std::endl;
    return true;
}

void Texture2D::bind(uint32_t slot) const {
    glActiveTexture(GL_TEXTURE0 + slot);
    glBindTexture(GL_TEXTURE_2D, textureId_);
}

void Texture2D::unbind() const {
    glBindTexture(GL_TEXTURE_2D, 0);
}

void Texture2D::setFilter(TextureFilter minFilter, TextureFilter magFilter) {
    glBindTexture(GL_TEXTURE_2D, textureId_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, getGLFilter(minFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, getGLFilter(magFilter));
    glBindTexture(GL_TEXTURE_2D, 0);
}

void Texture2D::setWrap(TextureWrap wrapS, TextureWrap wrapT) {
    glBindTexture(GL_TEXTURE_2D, textureId_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, getGLWrap(wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, getGLWrap(wrapT));
    glBindTexture(GL_TEXTURE_2D, 0);
}

void Texture2D::generateMipmaps() {
    glBindTexture(GL_TEXTURE_2D, textureId_);
    glGenerateMipmap(GL_TEXTURE_2D);
    glBindTexture(GL_TEXTURE_2D, 0);
}

void Texture2D::destroy() {
    if (textureId_) {
        glDeleteTextures(1, &textureId_);
        textureId_ = 0;
    }
}

void Texture2D::applyConfig(const TextureConfig& config) {
    // Set filtering
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, getGLFilter(config.minFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, getGLFilter(config.magFilter));

    // Set wrapping
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, getGLWrap(config.wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, getGLWrap(config.wrapT));
}

uint32_t Texture2D::getGLFilter(TextureFilter filter) const {
    switch (filter) {
        case TextureFilter::Nearest: return GL_NEAREST;
        case TextureFilter::Linear: return GL_LINEAR;
        case TextureFilter::NearestMipmapNearest: return GL_NEAREST_MIPMAP_NEAREST;
        case TextureFilter::LinearMipmapNearest: return GL_LINEAR_MIPMAP_NEAREST;
        case TextureFilter::NearestMipmapLinear: return GL_NEAREST_MIPMAP_LINEAR;
        case TextureFilter::LinearMipmapLinear: return GL_LINEAR_MIPMAP_LINEAR;
        default: return GL_LINEAR;
    }
}

uint32_t Texture2D::getGLWrap(TextureWrap wrap) const {
    switch (wrap) {
        case TextureWrap::Repeat: return GL_REPEAT;
        case TextureWrap::MirroredRepeat: return GL_MIRRORED_REPEAT;
        case TextureWrap::ClampToEdge: return GL_CLAMP_TO_EDGE;
        case TextureWrap::ClampToBorder: return GL_CLAMP_TO_BORDER;
        default: return GL_REPEAT;
    }
}

uint32_t Texture2D::getGLFormat(TextureFormat format) const {
    switch (format) {
        case TextureFormat::RGB: return GL_RGB;
        case TextureFormat::RGBA: return GL_RGBA;
        case TextureFormat::Red: return GL_RED;
        case TextureFormat::RG: return GL_RG;
        case TextureFormat::DepthComponent: return GL_DEPTH_COMPONENT;
        case TextureFormat::DepthStencil: return GL_DEPTH_STENCIL;
        default: return GL_RGBA;
    }
}

uint32_t Texture2D::getGLInternalFormat(TextureFormat format) const {
    switch (format) {
        case TextureFormat::RGB: return GL_RGB8;
        case TextureFormat::RGBA: return GL_RGBA8;
        case TextureFormat::Red: return GL_R8;
        case TextureFormat::RG: return GL_RG8;
        case TextureFormat::DepthComponent: return GL_DEPTH_COMPONENT24;
        case TextureFormat::DepthStencil: return GL_DEPTH24_STENCIL8;
        default: return GL_RGBA8;
    }
}

// TextureLibrary Implementation

TextureLibrary::~TextureLibrary() {
    clear();
}

Texture2D* TextureLibrary::load(const std::string& name, const std::string& path,
                                const TextureConfig& config) {
    if (exists(name)) {
        return textures_[name];
    }

    Texture2D* texture = new Texture2D();
    if (texture->loadFromFile(path, config)) {
        textures_[name] = texture;
        return texture;
    }

    delete texture;
    return nullptr;
}

void TextureLibrary::add(const std::string& name, Texture2D* texture) {
    if (exists(name)) {
        std::cerr << "[TextureLibrary] Texture '" << name << "' already exists" << std::endl;
        return;
    }
    textures_[name] = texture;
}

Texture2D* TextureLibrary::get(const std::string& name) {
    auto it = textures_.find(name);
    if (it != textures_.end()) {
        return it->second;
    }
    return nullptr;
}

bool TextureLibrary::exists(const std::string& name) const {
    return textures_.find(name) != textures_.end();
}

void TextureLibrary::createDefaultTextures() {
    // White texture (1x1)
    {
        uint8_t white[] = {255, 255, 255, 255};
        Texture2D* whiteTexture = new Texture2D();
        TextureConfig config;
        config.generateMipmaps = false;
        whiteTexture->createFromMemory(white, 1, 1, TextureFormat::RGBA, config);
        add("white", whiteTexture);
    }

    // Black texture (1x1)
    {
        uint8_t black[] = {0, 0, 0, 255};
        Texture2D* blackTexture = new Texture2D();
        TextureConfig config;
        config.generateMipmaps = false;
        blackTexture->createFromMemory(black, 1, 1, TextureFormat::RGBA, config);
        add("black", blackTexture);
    }

    // Normal map texture (default pointing up: 128, 128, 255)
    {
        uint8_t normal[] = {128, 128, 255, 255};
        Texture2D* normalTexture = new Texture2D();
        TextureConfig config;
        config.generateMipmaps = false;
        normalTexture->createFromMemory(normal, 1, 1, TextureFormat::RGBA, config);
        add("normal", normalTexture);
    }

    // Checkerboard texture (for testing)
    {
        const int size = 64;
        uint8_t checkerboard[size * size * 4];
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                bool isWhite = ((x / 8) + (y / 8)) % 2 == 0;
                int idx = (y * size + x) * 4;
                uint8_t color = isWhite ? 255 : 0;
                checkerboard[idx + 0] = color;
                checkerboard[idx + 1] = color;
                checkerboard[idx + 2] = color;
                checkerboard[idx + 3] = 255;
            }
        }
        Texture2D* checkerTexture = new Texture2D();
        checkerTexture->createFromMemory(checkerboard, size, size, TextureFormat::RGBA);
        add("checkerboard", checkerTexture);
    }

    std::cout << "[TextureLibrary] Created default textures" << std::endl;
}

void TextureLibrary::clear() {
    for (auto& pair : textures_) {
        delete pair.second;
    }
    textures_.clear();
}

} // namespace tilt
