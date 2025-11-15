# Contributing to TiLT

Thank you for your interest in contributing to TiLT! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions with the community.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/yourusername/TiLT/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - System information (OS, graphics card, etc.)
   - Relevant logs

### Suggesting Features

1. Check if the feature has been requested in [Issues](https://github.com/yourusername/TiLT/issues)
2. Create a new issue with:
   - Clear description of the feature
   - Use cases and benefits
   - Possible implementation approach

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Follow the coding style (see below)
5. Add tests if applicable
6. Update documentation
7. Commit your changes: `git commit -m 'Add amazing feature'`
8. Push to your fork: `git push origin feature/amazing-feature`
9. Open a Pull Request

## Coding Style

### C++ Code

- Use C++20 features where appropriate
- Follow the [Google C++ Style Guide](https://google.github.io/styleguide/cppguide.html) with these modifications:
  - 4 spaces for indentation (not 2)
  - 100 character line limit
  - Use `snake_case` for private members with trailing underscore
  - Use `PascalCase` for class names
  - Use `camelCase` for functions and public members

Example:
```cpp
class MyClass {
public:
    void doSomething();
    int getValue() const { return value_; }

private:
    void helperFunction();
    int value_;
    std::string name_;
};
```

### Documentation

- Document all public APIs with Doxygen-style comments
- Include usage examples for non-trivial functions
- Keep documentation up-to-date with code changes

Example:
```cpp
/**
 * @brief Loads a pinball table
 * @param tableFile Path to the table file (.vpx, .fp)
 * @throws std::runtime_error if table file cannot be loaded
 *
 * Example:
 * @code
 * engine.loadTable("medievalMadness.vpx");
 * @endcode
 */
void loadTable(const std::string& tableFile);
```

### Commit Messages

- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit first line to 72 characters
- Reference issues and pull requests when relevant

Example:
```
Add VR controller support for flippers

- Implement controller input mapping
- Add haptic feedback for flipper activation
- Update documentation with controller setup

Fixes #123
```

## Testing

- Write unit tests for new features
- Ensure all tests pass before submitting PR
- Run tests with: `ctest`

## Development Environment

### Required Tools

- CMake 3.20+
- C++20 compiler
- Git
- Code editor (VS Code, CLion, Visual Studio, etc.)

### Recommended VS Code Extensions

- C/C++ (Microsoft)
- CMake Tools
- GitLens
- Doxygen Documentation Generator

## Building for Development

```bash
# Debug build with tests
mkdir build-debug && cd build-debug
cmake -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTS=ON ..
cmake --build .

# Run tests
ctest --output-on-failure
```

## Areas Needing Contribution

We especially welcome contributions in these areas:

1. **ROM Emulation**
   - Additional machine type support
   - Improved timing accuracy
   - Sound emulation enhancements

2. **Physics Engine**
   - More realistic ball physics
   - Additional table elements (ramps, loops, etc.)
   - Performance optimizations

3. **Rendering**
   - DirectX 12 renderer implementation
   - Metal renderer for macOS/iOS
   - Advanced visual effects

4. **Frontend**
   - UI/UX improvements
   - Additional themes
   - Accessibility features

5. **Documentation**
   - User guides and tutorials
   - API documentation
   - Video tutorials

6. **Testing**
   - Unit tests
   - Integration tests
   - Performance benchmarks

## Questions?

If you have questions, feel free to:
- Open a [Discussion](https://github.com/yourusername/TiLT/discussions)
- Join our [Discord](https://discord.gg/tilt)
- Ask in the [Forum](https://forum.tilt.example.com)

Thank you for contributing to TiLT!
