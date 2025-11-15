/*
 * Installation Wizard
 */

#ifndef TILT_INSTALLER_WIZARD_HPP
#define TILT_INSTALLER_WIZARD_HPP

#include <string>

namespace tilt {

class InstallationWizard {
public:
    InstallationWizard();
    ~InstallationWizard();

    int run();

private:
    void detectSystem();
    void selectComponents();
    void configureDisplay();
    void installComponents();
    void postInstall();

    std::string installPath_;
    int screenWidth_;
    int screenHeight_;
    bool installVR_;
};

} // namespace tilt

#endif // TILT_INSTALLER_WIZARD_HPP
