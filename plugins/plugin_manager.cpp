/*
 * Plugin Manager - Manages plugins and extensions
 */

#include <iostream>
#include <string>
#include <vector>

namespace tilt {

class Plugin {
public:
    virtual ~Plugin() {}
    virtual void initialize() = 0;
    virtual void shutdown() = 0;
    virtual std::string getName() const = 0;
};

class PluginManager {
public:
    PluginManager() {
        std::cout << "[Plugin Manager] Initialized" << std::endl;
    }

    void loadPlugin(const std::string& pluginPath) {
        std::cout << "[Plugin Manager] Loading plugin: " << pluginPath << std::endl;

        // Load plugin shared library
        // Call initialization
    }

    void unloadPlugin(const std::string& pluginName) {
        std::cout << "[Plugin Manager] Unloading plugin: " << pluginName << std::endl;
    }

private:
    std::vector<Plugin*> plugins_;
};

} // namespace tilt
