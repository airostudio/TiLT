/*
 * Configuration Management Implementation
 */

#include "config.hpp"
#include <fstream>
#include <sstream>
#include <iostream>

namespace tilt {

Config::Config() {
    loadDefaults();
}

Config::~Config() {}

void Config::loadDefaults() {
    // Display settings
    setInt("display.width", 1920);
    setInt("display.height", 1080);
    setBool("display.fullscreen", false);
    setBool("display.vsync", true);

    // Renderer settings
    setString("renderer.type", "vulkan");
    setBool("renderer.vr", false);
    setInt("renderer.msaa", 4);

    // Physics settings
    setFloat("physics.gravity", 9.81f);
    setInt("physics.update_rate", 1000);

    // Audio settings
    setFloat("audio.master_volume", 1.0f);
    setFloat("audio.music_volume", 0.8f);
    setFloat("audio.sfx_volume", 1.0f);

    // Paths
    setString("paths.tables", "./data/tables");
    setString("paths.roms", "./data/roms");
    setString("paths.media", "./data/media");
    setString("paths.backglasses", "./data/backglasses");
}

void Config::load(const std::string& filename) {
    std::ifstream file(filename);
    if (!file.is_open()) {
        std::cerr << "[Config] Failed to open: " << filename << std::endl;
        return;
    }

    std::string line;
    while (std::getline(file, line)) {
        // Skip comments and empty lines
        if (line.empty() || line[0] == '#' || line[0] == ';') {
            continue;
        }

        // Parse key=value
        size_t pos = line.find('=');
        if (pos != std::string::npos) {
            std::string key = line.substr(0, pos);
            std::string value = line.substr(pos + 1);

            // Trim whitespace
            key.erase(0, key.find_first_not_of(" \t"));
            key.erase(key.find_last_not_of(" \t") + 1);
            value.erase(0, value.find_first_not_of(" \t"));
            value.erase(value.find_last_not_of(" \t") + 1);

            values_[key] = value;
        }
    }

    std::cout << "[Config] Loaded " << values_.size() << " settings from " << filename << std::endl;
}

void Config::save(const std::string& filename) {
    std::ofstream file(filename);
    if (!file.is_open()) {
        std::cerr << "[Config] Failed to save: " << filename << std::endl;
        return;
    }

    file << "# TiLT Configuration File\n\n";

    for (const auto& pair : values_) {
        file << pair.first << " = " << pair.second << "\n";
    }

    std::cout << "[Config] Saved " << values_.size() << " settings to " << filename << std::endl;
}

std::string Config::getString(const std::string& key, const std::string& defaultValue) const {
    auto it = values_.find(key);
    return (it != values_.end()) ? it->second : defaultValue;
}

int Config::getInt(const std::string& key, int defaultValue) const {
    auto it = values_.find(key);
    if (it != values_.end()) {
        return std::stoi(it->second);
    }
    return defaultValue;
}

float Config::getFloat(const std::string& key, float defaultValue) const {
    auto it = values_.find(key);
    if (it != values_.end()) {
        return std::stof(it->second);
    }
    return defaultValue;
}

bool Config::getBool(const std::string& key, bool defaultValue) const {
    auto it = values_.find(key);
    if (it != values_.end()) {
        return (it->second == "true" || it->second == "1" || it->second == "yes");
    }
    return defaultValue;
}

void Config::setString(const std::string& key, const std::string& value) {
    values_[key] = value;
}

void Config::setInt(const std::string& key, int value) {
    values_[key] = std::to_string(value);
}

void Config::setFloat(const std::string& key, float value) {
    values_[key] = std::to_string(value);
}

void Config::setBool(const std::string& key, bool value) {
    values_[key] = value ? "true" : "false";
}

} // namespace tilt
