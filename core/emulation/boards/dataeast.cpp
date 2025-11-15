/*
 * Data East Board Emulation
 */

#include "board_emulator.hpp"
#include <cstring>
#include <iostream>

namespace tilt {

DataEastBoardEmulator::DataEastBoardEmulator() {
    std::memset(switches_, 0, sizeof(switches_));
    std::memset(lamps_, 0, sizeof(lamps_));
    std::memset(solenoids_, 0, sizeof(solenoids_));
    std::cout << "[Data East Board] Initialized" << std::endl;
}

DataEastBoardEmulator::~DataEastBoardEmulator() {}

void DataEastBoardEmulator::update(float deltaTime) {}

void DataEastBoardEmulator::reset() {
    std::memset(switches_, 0, sizeof(switches_));
    std::memset(lamps_, 0, sizeof(lamps_));
    std::memset(solenoids_, 0, sizeof(solenoids_));
}

void DataEastBoardEmulator::setSwitchState(int switchNum, bool state) {
    if (switchNum >= 0 && switchNum < 128) {
        switches_[switchNum] = state ? 1 : 0;
    }
}

bool DataEastBoardEmulator::getSwitchState(int switchNum) const {
    if (switchNum >= 0 && switchNum < 128) {
        return switches_[switchNum] != 0;
    }
    return false;
}

uint8_t DataEastBoardEmulator::getLampState(int lampNum) const {
    if (lampNum >= 0 && lampNum < 64) {
        return lamps_[lampNum];
    }
    return 0;
}

uint8_t DataEastBoardEmulator::getSolenoidState(int solenoidNum) const {
    if (solenoidNum >= 0 && solenoidNum < 32) {
        return solenoids_[solenoidNum];
    }
    return 0;
}

} // namespace tilt
