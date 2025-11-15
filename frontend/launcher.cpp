/*
 * Launcher Implementation
 */

#include "launcher.hpp"
#include "../core/engine.hpp"
#include <iostream>

namespace tilt {

Launcher::Launcher(Engine* engine)
    : engine_(engine)
    , selectedIndex_(0)
{
    std::cout << "[Launcher] Initializing frontend..." << std::endl;
    loadTableDatabase();
}

Launcher::~Launcher() {}

void Launcher::run() {
    std::cout << "[Launcher] Starting frontend..." << std::endl;

    displayTableBrowser();

    // In a real implementation, this would show a GUI
    // For now, just launch the first table if available
    if (!tables_.empty()) {
        launchTable(tables_[0]);
    }
}

void Launcher::loadTableDatabase() {
    std::cout << "[Launcher] Loading table database..." << std::endl;

    // Load table metadata from database
    // This would scan the tables directory and build a database

    // Placeholder: add some demo tables
    TableInfo table1;
    table1.name = "Medieval Madness";
    table1.filename = "mm_109.vpx";
    table1.romName = "mm_109";
    table1.manufacturer = "Williams";
    table1.year = 1997;
    table1.rating = 5.0f;
    table1.playCount = 42;

    tables_.push_back(table1);

    TableInfo table2;
    table2.name = "Attack from Mars";
    table2.filename = "afm_113.vpx";
    table2.romName = "afm_113";
    table2.manufacturer = "Bally";
    table2.year = 1995;
    table2.rating = 4.8f;
    table2.playCount = 38;

    tables_.push_back(table2);

    std::cout << "[Launcher] Loaded " << tables_.size() << " tables" << std::endl;
}

void Launcher::displayTableBrowser() {
    std::cout << "\n========== TiLT Table Browser ==========\n" << std::endl;

    for (size_t i = 0; i < tables_.size(); i++) {
        const auto& table = tables_[i];
        std::cout << (i + 1) << ". " << table.name << std::endl;
        std::cout << "   " << table.manufacturer << " (" << table.year << ")" << std::endl;
        std::cout << "   Rating: " << table.rating << "/5.0" << std::endl;
        std::cout << "   Played: " << table.playCount << " times" << std::endl;
        std::cout << std::endl;
    }
}

void Launcher::launchTable(const TableInfo& table) {
    std::cout << "[Launcher] Launching table: " << table.name << std::endl;

    // Load ROM if specified
    if (!table.romName.empty()) {
        engine_->loadROM(table.romName);
    }

    // Load table
    engine_->loadTable(table.filename);

    // Run game
    engine_->run();
}

} // namespace tilt
