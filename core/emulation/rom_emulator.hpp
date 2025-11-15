/*
 * ROM Emulator - PinMAME-based pinball ROM emulation
 * Emulates the electronic circuit boards and displays from pinball machines
 */

#ifndef TILT_EMULATION_ROM_EMULATOR_HPP
#define TILT_EMULATION_ROM_EMULATOR_HPP

#include <string>
#include <memory>
#include <vector>
#include <cstdint>

namespace tilt {

// Forward declarations
class CPUEmulator;
class SoundEmulator;
class DMDEmulator;
class BoardEmulator;

enum class MachineType {
    Unknown,
    WilliamsBally_WPC,      // Williams/Bally WPC system
    WilliamsBally_Sys11,    // Williams/Bally System 11
    DataEast_AlphaNum,      // Data East AlphaNumeric
    DataEast_DMD,           // Data East DMD
    Sega_Whitestar,         // Sega/Stern Whitestar
    Stern_SAM,              // Stern SAM
    Gottlieb_Sys1,          // Gottlieb System 1
    Gottlieb_Sys80,         // Gottlieb System 80
    Gottlieb_Sys3           // Gottlieb System 3
};

struct ROMInfo {
    std::string name;
    std::string description;
    std::string manufacturer;
    int year;
    MachineType type;
    std::vector<std::string> romFiles;
    bool hasDMD;
    bool hasAlphaNumeric;
    int displayWidth;
    int displayHeight;
};

class ROMEmulator {
public:
    ROMEmulator();
    ~ROMEmulator();

    // ROM management
    void loadROM(const std::string& romName);
    void unloadROM();
    bool isLoaded() const { return loaded_; }

    // ROM information
    const ROMInfo& getROMInfo() const { return romInfo_; }
    std::vector<std::string> getAvailableROMs() const;

    // Emulation control
    void update(float deltaTime);
    void reset();
    void pause();
    void resume();

    // Input/Output
    void setSwitchState(int switchNum, bool state);
    bool getSwitchState(int switchNum) const;
    void setDipSwitch(int dipNum, bool state);

    uint8_t getLampState(int lampNum) const;
    uint8_t getSolenoidState(int solenoidNum) const;

    // Display access
    const uint8_t* getDMDBuffer() const;
    int getDMDWidth() const { return romInfo_.displayWidth; }
    int getDMDHeight() const { return romInfo_.displayHeight; }

    // Audio access
    const int16_t* getAudioBuffer(int& sampleCount) const;
    int getAudioSampleRate() const { return 48000; }

    // Statistics
    uint64_t getCycleCount() const { return cycleCount_; }
    float getEmulationSpeed() const { return emulationSpeed_; }

private:
    void detectMachineType();
    void initializeBoard();
    void loadROMFiles();

    // ROM info
    ROMInfo romInfo_;
    std::string currentROM_;
    bool loaded_;

    // Emulation subsystems
    std::unique_ptr<CPUEmulator> cpuEmulator_;
    std::unique_ptr<SoundEmulator> soundEmulator_;
    std::unique_ptr<DMDEmulator> dmdEmulator_;
    std::unique_ptr<BoardEmulator> boardEmulator_;

    // State
    std::vector<bool> switches_;
    std::vector<bool> dipSwitches_;
    std::vector<uint8_t> lamps_;
    std::vector<uint8_t> solenoids_;

    // Statistics
    uint64_t cycleCount_;
    float emulationSpeed_;
    bool paused_;
};

} // namespace tilt

#endif // TILT_EMULATION_ROM_EMULATOR_HPP
