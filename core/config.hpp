/*
 * Configuration Management
 */

#ifndef TILT_CORE_CONFIG_HPP
#define TILT_CORE_CONFIG_HPP

#include <string>
#include <map>

namespace tilt {

class Config {
public:
    Config();
    ~Config();

    void load(const std::string& filename);
    void save(const std::string& filename);
    void loadDefaults();

    // Get/Set values
    std::string getString(const std::string& key, const std::string& defaultValue = "") const;
    int getInt(const std::string& key, int defaultValue = 0) const;
    float getFloat(const std::string& key, float defaultValue = 0.0f) const;
    bool getBool(const std::string& key, bool defaultValue = false) const;

    void setString(const std::string& key, const std::string& value);
    void setInt(const std::string& key, int value);
    void setFloat(const std::string& key, float value);
    void setBool(const std::string& key, bool value);

private:
    std::map<std::string, std::string> values_;
};

} // namespace tilt

#endif // TILT_CORE_CONFIG_HPP
