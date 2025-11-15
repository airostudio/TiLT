/*
 * ROM Emulator Implementation
 */

#include "rom_emulator.hpp"
#include "cpu/cpu_emulator.hpp"
#include "sound/sound_emulator.hpp"
#include "display/dmd_emulator.hpp"
#include "boards/board_emulator.hpp"
#include <iostream>
#include <algorithm>

namespace tilt {

ROMEmulator::ROMEmulator()
    : loaded_(false)
    , cycleCount_(0)
    , emulationSpeed_(1.0f)
    , paused_(false)
{
    // Initialize with reasonable defaults
    switches_.resize(128, false);
    dipSwitches_.resize(32, false);
    lamps_.resize(64, 0);
    solenoids_.resize(32, 0);

    std::cout << "[ROM Emulator] Initialized" << std::endl;
}

ROMEmulator::~ROMEmulator() {
    unloadROM();
}

void ROMEmulator::loadROM(const std::string& romName) {
    if (loaded_) {
        unloadROM();
    }

    std::cout << "[ROM Emulator] Loading ROM: " << romName << std::endl;
    currentROM_ = romName;

    // Initialize ROM info
    romInfo_.name = romName;

    // Detect machine type based on ROM name
    detectMachineType();

    // Load ROM files
    loadROMFiles();

    // Initialize board emulation
    initializeBoard();

    loaded_ = true;
    std::cout << "[ROM Emulator] ROM loaded successfully" << std::endl;
    std::cout << "[ROM Emulator] Machine type: ";

    switch (romInfo_.type) {
        case MachineType::WilliamsBally_WPC:
            std::cout << "Williams/Bally WPC";
            break;
        case MachineType::WilliamsBally_Sys11:
            std::cout << "Williams/Bally System 11";
            break;
        case MachineType::DataEast_DMD:
            std::cout << "Data East DMD";
            break;
        case MachineType::Sega_Whitestar:
            std::cout << "Sega/Stern Whitestar";
            break;
        case MachineType::Stern_SAM:
            std::cout << "Stern SAM";
            break;
        default:
            std::cout << "Unknown";
            break;
    }
    std::cout << std::endl;
}

void ROMEmulator::unloadROM() {
    if (!loaded_) {
        return;
    }

    std::cout << "[ROM Emulator] Unloading ROM: " << currentROM_ << std::endl;

    boardEmulator_.reset();
    dmdEmulator_.reset();
    soundEmulator_.reset();
    cpuEmulator_.reset();

    currentROM_.clear();
    loaded_ = false;
    cycleCount_ = 0;
}

void ROMEmulator::detectMachineType() {
    // Simple heuristics based on ROM name
    // In real implementation, would examine ROM header/files

    std::string lower = currentROM_;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

    if (lower.find("tz_") != std::string::npos ||
        lower.find("mm_") != std::string::npos ||
        lower.find("afm_") != std::string::npos ||
        lower.find("t2_") != std::string::npos) {
        romInfo_.type = MachineType::WilliamsBally_WPC;
        romInfo_.manufacturer = "Williams/Bally";
        romInfo_.hasDMD = true;
        romInfo_.displayWidth = 128;
        romInfo_.displayHeight = 32;
    }
    else if (lower.find("trek_") != std::string::npos ||
             lower.find("jd_") != std::string::npos) {
        romInfo_.type = MachineType::DataEast_DMD;
        romInfo_.manufacturer = "Data East";
        romInfo_.hasDMD = true;
        romInfo_.displayWidth = 128;
        romInfo_.displayHeight = 32;
    }
    else if (lower.find("lotr_") != std::string::npos ||
             lower.find("tspp_") != std::string::npos) {
        romInfo_.type = MachineType::Stern_SAM;
        romInfo_.manufacturer = "Stern";
        romInfo_.hasDMD = true;
        romInfo_.displayWidth = 128;
        romInfo_.displayHeight = 32;
    }
    else {
        romInfo_.type = MachineType::WilliamsBally_WPC;
        romInfo_.manufacturer = "Unknown";
        romInfo_.hasDMD = true;
        romInfo_.displayWidth = 128;
        romInfo_.displayHeight = 32;
    }
}

void ROMEmulator::loadROMFiles() {
    // In real implementation, would load actual ROM files
    std::cout << "[ROM Emulator] Loading ROM files..." << std::endl;

    // Placeholder - would load files from data/roms/ directory
    romInfo_.romFiles.push_back(currentROM_ + ".u6");
    romInfo_.romFiles.push_back(currentROM_ + ".u2");
}

void ROMEmulator::initializeBoard() {
    std::cout << "[ROM Emulator] Initializing board emulation..." << std::endl;

    // Create appropriate emulators based on machine type
    switch (romInfo_.type) {
        case MachineType::WilliamsBally_WPC:
            cpuEmulator_ = std::make_unique<CPUEmulator>(CPUType::M6809);
            boardEmulator_ = std::make_unique<WPCBoardEmulator>();
            break;

        case MachineType::DataEast_DMD:
            cpuEmulator_ = std::make_unique<CPUEmulator>(CPUType::M6809);
            boardEmulator_ = std::make_unique<DataEastBoardEmulator>();
            break;

        case MachineType::Sega_Whitestar:
        case MachineType::Stern_SAM:
            cpuEmulator_ = std::make_unique<CPUEmulator>(CPUType::M6809);
            boardEmulator_ = std::make_unique<WhitestarBoardEmulator>();
            break;

        default:
            cpuEmulator_ = std::make_unique<CPUEmulator>(CPUType::M6809);
            boardEmulator_ = std::make_unique<WPCBoardEmulator>();
            break;
    }

    // Create sound emulator
    soundEmulator_ = std::make_unique<SoundEmulator>();

    // Create DMD emulator if machine has DMD
    if (romInfo_.hasDMD) {
        dmdEmulator_ = std::make_unique<DMDEmulator>(
            romInfo_.displayWidth,
            romInfo_.displayHeight
        );
    }
}

void ROMEmulator::update(float deltaTime) {
    if (!loaded_ || paused_) {
        return;
    }

    // Calculate cycles to execute based on deltaTime
    // Typical pinball CPU runs at ~1-2 MHz
    const uint32_t cyclesPerSecond = 2000000; // 2 MHz
    uint32_t cyclesToExecute = static_cast<uint32_t>(cyclesPerSecond * deltaTime);

    // Execute CPU cycles
    if (cpuEmulator_) {
        cpuEmulator_->execute(cyclesToExecute);
        cycleCount_ += cyclesToExecute;
    }

    // Update board
    if (boardEmulator_) {
        boardEmulator_->update(deltaTime);
    }

    // Update sound
    if (soundEmulator_) {
        soundEmulator_->update(deltaTime);
    }

    // Update DMD
    if (dmdEmulator_) {
        dmdEmulator_->update(deltaTime);
    }
}

void ROMEmulator::reset() {
    std::cout << "[ROM Emulator] Resetting machine..." << std::endl;

    cycleCount_ = 0;

    if (cpuEmulator_) {
        cpuEmulator_->reset();
    }
    if (boardEmulator_) {
        boardEmulator_->reset();
    }
    if (soundEmulator_) {
        soundEmulator_->reset();
    }
    if (dmdEmulator_) {
        dmdEmulator_->reset();
    }
}

void ROMEmulator::pause() {
    paused_ = true;
}

void ROMEmulator::resume() {
    paused_ = false;
}

void ROMEmulator::setSwitchState(int switchNum, bool state) {
    if (switchNum >= 0 && switchNum < static_cast<int>(switches_.size())) {
        switches_[switchNum] = state;
        if (boardEmulator_) {
            boardEmulator_->setSwitchState(switchNum, state);
        }
    }
}

bool ROMEmulator::getSwitchState(int switchNum) const {
    if (switchNum >= 0 && switchNum < static_cast<int>(switches_.size())) {
        return switches_[switchNum];
    }
    return false;
}

void ROMEmulator::setDipSwitch(int dipNum, bool state) {
    if (dipNum >= 0 && dipNum < static_cast<int>(dipSwitches_.size())) {
        dipSwitches_[dipNum] = state;
    }
}

uint8_t ROMEmulator::getLampState(int lampNum) const {
    if (lampNum >= 0 && lampNum < static_cast<int>(lamps_.size())) {
        return lamps_[lampNum];
    }
    return 0;
}

uint8_t ROMEmulator::getSolenoidState(int solenoidNum) const {
    if (solenoidNum >= 0 && solenoidNum < static_cast<int>(solenoids_.size())) {
        return solenoids_[solenoidNum];
    }
    return 0;
}

const uint8_t* ROMEmulator::getDMDBuffer() const {
    if (dmdEmulator_) {
        return dmdEmulator_->getBuffer();
    }
    return nullptr;
}

const int16_t* ROMEmulator::getAudioBuffer(int& sampleCount) const {
    if (soundEmulator_) {
        return soundEmulator_->getAudioBuffer(sampleCount);
    }
    sampleCount = 0;
    return nullptr;
}

std::vector<std::string> ROMEmulator::getAvailableROMs() const {
    // In real implementation, would scan data/roms/ directory
    return {
        "tz_94h",      // Twilight Zone
        "mm_109",      // Medieval Madness
        "afm_113",     // Attack from Mars
        "t2_l8",       // Terminator 2
        "lotr_le10"    // Lord of the Rings
    };
}

} // namespace tilt
