/*
 * Script Engine - VBScript compatible scripting
 */

#ifndef TILT_SCRIPTING_SCRIPT_ENGINE_HPP
#define TILT_SCRIPTING_SCRIPT_ENGINE_HPP

#include <string>

namespace tilt {

class ScriptEngine {
public:
    ScriptEngine();
    ~ScriptEngine();

    void update(float deltaTime);

    // Script management
    void loadTableScripts(const std::string& tableFile);
    void unloadTableScripts();

    // Script execution
    void executeScript(const std::string& script);
    void callFunction(const std::string& functionName);

    // Event handling
    void onSwitchEvent(int switchNum, bool state);
    void onTimerEvent(const std::string& timerName);

private:
    bool initialized_;
};

} // namespace tilt

#endif // TILT_SCRIPTING_SCRIPT_ENGINE_HPP
