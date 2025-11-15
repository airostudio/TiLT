/*
 * Launcher - PinUP-inspired frontend/launcher
 */

#ifndef TILT_FRONTEND_LAUNCHER_HPP
#define TILT_FRONTEND_LAUNCHER_HPP

#include <string>
#include <vector>

namespace tilt {

class Engine;

struct TableInfo {
    std::string name;
    std::string filename;
    std::string romName;
    std::string manufacturer;
    int year;
    float rating;
    int playCount;
    std::string thumbnailPath;
    std::string wheelImagePath;
    std::string videoPath;
};

class Launcher {
public:
    Launcher(Engine* engine);
    ~Launcher();

    void run();

private:
    void loadTableDatabase();
    void displayTableBrowser();
    void launchTable(const TableInfo& table);

    Engine* engine_;
    std::vector<TableInfo> tables_;
    int selectedIndex_;
};

} // namespace tilt

#endif // TILT_FRONTEND_LAUNCHER_HPP
