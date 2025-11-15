/*
 * Board Emulator - Base class for pinball hardware boards
 */

#ifndef TILT_EMULATION_BOARDS_BOARD_EMULATOR_HPP
#define TILT_EMULATION_BOARDS_BOARD_EMULATOR_HPP

#include <cstdint>

namespace tilt {

class BoardEmulator {
public:
    virtual ~BoardEmulator() {}

    virtual void update(float deltaTime) = 0;
    virtual void reset() = 0;

    virtual void setSwitchState(int switchNum, bool state) = 0;
    virtual bool getSwitchState(int switchNum) const = 0;

    virtual uint8_t getLampState(int lampNum) const = 0;
    virtual uint8_t getSolenoidState(int solenoidNum) const = 0;
};

// Williams/Bally WPC Board
class WPCBoardEmulator : public BoardEmulator {
public:
    WPCBoardEmulator();
    ~WPCBoardEmulator() override;

    void update(float deltaTime) override;
    void reset() override;

    void setSwitchState(int switchNum, bool state) override;
    bool getSwitchState(int switchNum) const override;

    uint8_t getLampState(int lampNum) const override;
    uint8_t getSolenoidState(int solenoidNum) const override;

private:
    uint8_t switches_[128];
    uint8_t lamps_[64];
    uint8_t solenoids_[32];
};

// Data East Board
class DataEastBoardEmulator : public BoardEmulator {
public:
    DataEastBoardEmulator();
    ~DataEastBoardEmulator() override;

    void update(float deltaTime) override;
    void reset() override;

    void setSwitchState(int switchNum, bool state) override;
    bool getSwitchState(int switchNum) const override;

    uint8_t getLampState(int lampNum) const override;
    uint8_t getSolenoidState(int solenoidNum) const override;

private:
    uint8_t switches_[128];
    uint8_t lamps_[64];
    uint8_t solenoids_[32];
};

// Sega/Stern Whitestar Board
class WhitestarBoardEmulator : public BoardEmulator {
public:
    WhitestarBoardEmulator();
    ~WhitestarBoardEmulator() override;

    void update(float deltaTime) override;
    void reset() override;

    void setSwitchState(int switchNum, bool state) override;
    bool getSwitchState(int switchNum) const override;

    uint8_t getLampState(int lampNum) const override;
    uint8_t getSolenoidState(int solenoidNum) const override;

private:
    uint8_t switches_[128];
    uint8_t lamps_[64];
    uint8_t solenoids_[32];
};

} // namespace tilt

#endif // TILT_EMULATION_BOARDS_BOARD_EMULATOR_HPP
