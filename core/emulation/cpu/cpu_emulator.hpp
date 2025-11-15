/*
 * CPU Emulator - Multi-CPU support for pinball machines
 */

#ifndef TILT_EMULATION_CPU_EMULATOR_HPP
#define TILT_EMULATION_CPU_EMULATOR_HPP

#include <cstdint>
#include <vector>
#include <memory>

namespace tilt {

enum class CPUType {
    Z80,        // Zilog Z80 - used in many early pinball machines
    M6800,      // Motorola 6800
    M6809,      // Motorola 6809 - used in Williams WPC, Data East
    M68000,     // Motorola 68000 - used in some later machines
    ARM         // ARM - used in modern Stern machines
};

class CPUCore;

class CPUEmulator {
public:
    CPUEmulator(CPUType type);
    ~CPUEmulator();

    void reset();
    uint32_t execute(uint32_t cycles);

    // Memory access
    uint8_t readByte(uint16_t address);
    void writeByte(uint16_t address, uint8_t value);
    uint16_t readWord(uint16_t address);
    void writeWord(uint16_t address, uint16_t value);

    // Registers
    uint16_t getPC() const;
    void setPC(uint16_t value);

    // Interrupts
    void triggerIRQ();
    void triggerNMI();

    CPUType getType() const { return type_; }

private:
    CPUType type_;
    std::unique_ptr<CPUCore> core_;
    std::vector<uint8_t> memory_;
};

} // namespace tilt

#endif // TILT_EMULATION_CPU_EMULATOR_HPP
