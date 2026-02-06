/*
 * OpenGL Texture System
 * Texture loading, management, and sampling using stb_image
 */

#pragma once

#include <string>
#include <cstdint>
#include <unordered_map>

namespace tilt {

/**
 * Texture filtering modes
 */
enum class TextureFilter {
    Nearest,
    Linear,
    NearestMipmapNearest,
    LinearMipmapNearest,
    NearestMipmapLinear,
    LinearMipmapLinear
};

/**
 * Texture wrapping modes
 */
enum class TextureWrap {
    Repeat,
    MirroredRepeat,
    ClampToEdge,
    ClampToBorder
};

/**
 * Texture format
 */
enum class TextureFormat {
    RGB,
    RGBA,
    Red,
    RG,
    DepthComponent,
    DepthStencil
};

/**
 * Texture configuration
 */
struct TextureConfig {
    TextureFilter minFilter = TextureFilter::LinearMipmapLinear;
    TextureFilter magFilter = TextureFilter::Linear;
    TextureWrap wrapS = TextureWrap::Repeat;
    TextureWrap wrapT = TextureWrap::Repeat;
    bool generateMipmaps = true;
    bool flipVertically = true;
};

/**
 * Texture2D
 * Manages OpenGL 2D textures
 */
class Texture2D {
public:
    Texture2D();
    ~Texture2D();

    // Disable copy
    Texture2D(const Texture2D&) = delete;
    Texture2D& operator=(const Texture2D&) = delete;

    /**
     * Load texture from file
     */
    bool loadFromFile(const std::string& path, const TextureConfig& config = TextureConfig());

    /**
     * Create texture from memory
     */
    bool createFromMemory(const uint8_t* data, uint32_t width, uint32_t height,
                          TextureFormat format, const TextureConfig& config = TextureConfig());

    /**
     * Create empty texture (for framebuffer attachments, etc.)
     */
    bool createEmpty(uint32_t width, uint32_t height, TextureFormat format,
                     const TextureConfig& config = TextureConfig());

    /**
     * Bind texture to texture unit
     */
    void bind(uint32_t slot = 0) const;
    void unbind() const;

    /**
     * Get properties
     */
    uint32_t getTextureId() const { return textureId_; }
    uint32_t getWidth() const { return width_; }
    uint32_t getHeight() const { return height_; }
    bool isValid() const { return textureId_ != 0; }

    /**
     * Update texture parameters
     */
    void setFilter(TextureFilter minFilter, TextureFilter magFilter);
    void setWrap(TextureWrap wrapS, TextureWrap wrapT);

    /**
     * Generate mipmaps manually
     */
    void generateMipmaps();

    /**
     * Cleanup
     */
    void destroy();

private:
    uint32_t textureId_;
    uint32_t width_;
    uint32_t height_;
    TextureFormat format_;

    void applyConfig(const TextureConfig& config);
    uint32_t getGLFilter(TextureFilter filter) const;
    uint32_t getGLWrap(TextureWrap wrap) const;
    uint32_t getGLFormat(TextureFormat format) const;
    uint32_t getGLInternalFormat(TextureFormat format) const;
};

/**
 * Texture Library
 * Manages multiple textures with named access
 */
class TextureLibrary {
public:
    TextureLibrary() = default;
    ~TextureLibrary();

    /**
     * Load texture from file
     */
    Texture2D* load(const std::string& name, const std::string& path,
                    const TextureConfig& config = TextureConfig());

    /**
     * Add existing texture
     */
    void add(const std::string& name, Texture2D* texture);

    /**
     * Get texture by name
     */
    Texture2D* get(const std::string& name);

    /**
     * Check if texture exists
     */
    bool exists(const std::string& name) const;

    /**
     * Create default textures (white, black, normal, etc.)
     */
    void createDefaultTextures();

    /**
     * Clear all textures
     */
    void clear();

private:
    std::unordered_map<std::string, Texture2D*> textures_;
};

} // namespace tilt
