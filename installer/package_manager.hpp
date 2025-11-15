/*
 * Package Manager
 */

#ifndef TILT_INSTALLER_PACKAGE_MANAGER_HPP
#define TILT_INSTALLER_PACKAGE_MANAGER_HPP

#include <string>
#include <vector>

namespace tilt {

struct Package {
    std::string name;
    std::string version;
    std::string description;
    std::vector<std::string> dependencies;
    size_t downloadSize;
    size_t installedSize;
};

class PackageManager {
public:
    PackageManager();
    ~PackageManager();

    void installPackage(const std::string& packageName);
    void uninstallPackage(const std::string& packageName);
    void updatePackage(const std::string& packageName);

    std::vector<Package> getAvailablePackages();
    std::vector<Package> getInstalledPackages();

private:
    void downloadPackage(const std::string& packageName);
    void extractPackage(const std::string& packageFile);
    void resolveDependencies(const std::string& packageName);

    std::vector<Package> installed_;
};

} // namespace tilt

#endif // TILT_INSTALLER_PACKAGE_MANAGER_HPP
