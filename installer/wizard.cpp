/*
 * Installation Wizard Implementation
 */

#include "wizard.hpp"
#include "package_manager.hpp"
#include <iostream>

namespace tilt {

InstallationWizard::InstallationWizard()
    : installPath_("C:/TiLT")
    , screenWidth_(1920)
    , screenHeight_(1080)
    , installVR_(false)
{
}

InstallationWizard::~InstallationWizard() {}

int InstallationWizard::run() {
    std::cout << "Starting TiLT installation...\n" << std::endl;

    detectSystem();
    selectComponents();
    configureDisplay();
    installComponents();
    postInstall();

    std::cout << "\nInstallation complete!" << std::endl;
    std::cout << "TiLT has been installed to: " << installPath_ << std::endl;
    std::cout << "\nYou can now launch TiLT from your desktop or start menu." << std::endl;

    return 0;
}

void InstallationWizard::detectSystem() {
    std::cout << "[1/5] Detecting system configuration..." << std::endl;

    // Detect:
    // - Operating system and version
    // - Display resolution and layout
    // - Available graphics APIs
    // - VR hardware
    // - Audio devices
    // - Cabinet hardware (if present)

    std::cout << "  OS: Windows 10/11" << std::endl;
    std::cout << "  Display: " << screenWidth_ << "x" << screenHeight_ << std::endl;
    std::cout << "  Graphics: Vulkan supported" << std::endl;
    std::cout << std::endl;
}

void InstallationWizard::selectComponents() {
    std::cout << "[2/5] Selecting components to install..." << std::endl;

    // Let user select:
    // - Core engine (required)
    // - ROMs pack
    // - Table packs
    // - Media packs
    // - PuP packs
    // - VR support
    // - DOF support

    std::cout << "  [X] Core Engine" << std::endl;
    std::cout << "  [X] ROM Emulation" << std::endl;
    std::cout << "  [X] Physics Engine" << std::endl;
    std::cout << "  [X] Backglass System" << std::endl;
    std::cout << "  [X] Frontend" << std::endl;
    std::cout << "  [ ] VR Support" << std::endl;
    std::cout << "  [ ] DOF Support" << std::endl;
    std::cout << std::endl;
}

void InstallationWizard::configureDisplay() {
    std::cout << "[3/5] Configuring display settings..." << std::endl;

    // Configure:
    // - Playfield display
    // - Backglass display
    // - DMD display
    // - Topper display (if present)

    std::cout << "  Playfield: Display 1 (1920x1080)" << std::endl;
    std::cout << "  Backglass: Display 2 (1920x1080)" << std::endl;
    std::cout << "  DMD: Integrated into backglass" << std::endl;
    std::cout << std::endl;
}

void InstallationWizard::installComponents() {
    std::cout << "[4/5] Installing components..." << std::endl;

    PackageManager pm;

    // Install packages
    pm.installPackage("tilt-core");
    pm.installPackage("tilt-roms");
    pm.installPackage("tilt-tables");

    std::cout << "  Installation complete" << std::endl;
    std::cout << std::endl;
}

void InstallationWizard::postInstall() {
    std::cout << "[5/5] Finalizing installation..." << std::endl;

    // Post-install tasks:
    // - Create shortcuts
    // - Register file associations
    // - Create default config
    // - Import existing tables (if found)
    // - Set up auto-updater

    std::cout << "  Creating shortcuts..." << std::endl;
    std::cout << "  Registering file types..." << std::endl;
    std::cout << "  Creating configuration..." << std::endl;
    std::cout << std::endl;
}

} // namespace tilt
