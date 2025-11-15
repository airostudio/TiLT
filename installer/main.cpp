/*
 * TiLT Installer - Baller-inspired installation system
 */

#include <iostream>
#include "wizard.hpp"

int main(int argc, char* argv[]) {
    std::cout << R"(
  _____ _ _   _____    ___           _        _ _
 |_   _(_) | |_   _|  |_ _|_ __  ___| |_ __ _| | | ___ _ __
   | | | | |   | |     | ||  _ \/ __| __/ _  | | |/ _ \  __|
   | | | | |___| |     | || | | \__ \ || (_| | | |  __/ |
   |_| |_|_____|_|    |___|_| |_|___/\__\__,_|_|_|\___|_|

 TiLT Installation Wizard
 Version 1.0.0
    )" << std::endl;

    tilt::InstallationWizard wizard;
    return wizard.run();
}
