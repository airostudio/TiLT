# TiLT Import System Guide

The TiLT Import System provides an easy, intelligent way to import pinball content from ZIP files. It automatically detects file types and organizes them into the appropriate folders.

## Features

✅ **Intelligent File Classification** - Automatically detects and categorizes files
✅ **Smart Organization** - Places files in the correct folders based on type
✅ **Drag & Drop Support** - Simply drag ZIP files into TiLT
✅ **Batch Import** - Import multiple ZIP files at once
✅ **Preview Before Import** - See what will be imported before committing
✅ **Automatic Backups** - Safely backup existing files before overwriting
✅ **Progress Tracking** - Real-time progress updates
✅ **Error Recovery** - Continues importing even if some files fail

## Quick Start

### Method 1: Drag & Drop (Easiest)

1. Launch TiLT
2. Go to **Tools → Import Content** (or press `Ctrl+I`)
3. Drag your ZIP files into the drop zone
4. Click **Import**

### Method 2: Command Line

```bash
# Import a single ZIP file
tilt-import table_pack.zip

# Import multiple files
tilt-import file1.zip file2.zip file3.zip

# Import all ZIPs from a directory
tilt-import -d ~/Downloads

# Show GUI importer
tilt-import -g
```

### Method 3: File Browser

1. Launch TiLT
2. Go to **Tools → Import Content**
3. Click **Browse Files** or **Browse Folder**
4. Select your ZIP files
5. Click **Import**

## Supported File Types

TiLT automatically recognizes and organizes these file types:

### Tables
- **VPX Files** (`.vpx`, `.vpt`) → `data/tables/`
- **Future Pinball** (`.fpt`, `.fp`) → `data/tables/`

### ROMs
- **ROM Files** (`.zip`, `.u6`, `.u2`) → `data/roms/`

### Backglasses
- **DirectB2S** (`.directb2s`, `.b2s`) → `data/backglasses/`
- **B2S Backglass** (`.b2sbackglass`) → `data/backglasses/`

### Media

#### Images
- **Artwork** (`.png`, `.jpg`, `.jpeg`) → `data/media/artwork/`
- **Wheel Images** (*wheel*.png) → `data/media/wheels/`
- **Screenshots** (*screen*.png) → `data/media/screenshots/`

#### Videos
- **Table Videos** (`.mp4`, `.avi`, `.mkv`, `.webm`) → `data/media/videos/`

#### Audio
- **Music** (`.mp3`, `.ogg`, `.flac`) → `data/media/audio/`
- **Sound Effects** (`.wav`) → `data/media/audio/`

### Other
- **PuP Packs** (`.pup`) → `data/pup/`
- **DMD Files** (`.cRZ`, `.pal`) → `data/dmd/`
- **POV Files** (`.pov`) → `data/config/`
- **Scripts** (`.vbs`, `.lua`) → `data/scripts/`
- **Config** (`.ini`, `.cfg`) → `data/config/`

## Import Options

### Auto-Organize
When enabled (default), files are automatically sorted into appropriate folders based on their type.

**Enabled:** `table.vpx` → `data/tables/table.vpx`
**Disabled:** `table.vpx` → `data/table.vpx`

### Overwrite Existing
Controls what happens when importing a file that already exists:

- **Prompt (default):** Ask before overwriting
- **Always:** Overwrite without asking
- **Never:** Skip existing files

### Create Backups
When enabled (default), existing files are backed up before being overwritten.

**Backup location:** `data/backups/`
**Backup format:** `filename.ext.bak`

### Show Preview
When enabled (default), shows a preview of files to be imported before proceeding.

## Command Line Reference

```bash
tilt-import [options] <files...>

Options:
  -h, --help              Show help message
  -g, --gui               Show graphical import interface
  -d, --dir <directory>   Import all ZIP files from directory
  -p, --preview           Preview contents before importing
  -b, --base-path <path>  Set base import path (default: ./data)
  -y, --yes               Auto-confirm all prompts
  -n, --no-backup         Don't create backups of existing files
  -o, --overwrite         Overwrite existing files without asking
  -v, --verbose           Verbose output
```

### Examples

#### Import a single table pack
```bash
tilt-import MedievalMadness_Complete.zip
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Importing: MedievalMadness_Complete.zip
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Extracting to: /tmp/tilt_import_MedievalMadness_Complete
Found 6 files
  Found: MedievalMadness.vpx (45 MB) -> Type: TABLE
  Found: mm_109.zip (2 MB) -> Type: ROM
  Found: MedievalMadness.directb2s (5 MB) -> Type: BACKGLASS
  Found: MedievalMadness.png (1 MB) -> Type: IMAGE
  Found: MedievalMadness.mp4 (80 MB) -> Type: VIDEO
  Found: MedievalMadness_wheel.png (500 KB) -> Type: WHEEL

Progress: [████████████████████████████████████████] 100% (6/6)

✅  Import Complete!
Total files imported: 6
Files are organized in: ./data
```

#### Import multiple files
```bash
tilt-import table1.zip table2.zip table3.zip
```

#### Import all ZIPs from Downloads folder
```bash
tilt-import -d ~/Downloads
```

#### Preview before importing
```bash
tilt-import -p MyTable.zip
```

#### Import without creating backups
```bash
tilt-import -n -o MyTable.zip
```

#### Custom import location
```bash
tilt-import -b /mnt/pinball/data MyTable.zip
```

## Directory Structure

After importing, your files will be organized like this:

```
data/
├── tables/              # Table files (.vpx, .fp, .fpt)
├── roms/                # ROM files (.zip)
├── backglasses/         # Backglass files (.directb2s, .b2s)
├── media/
│   ├── artwork/         # Table artwork images
│   ├── videos/          # Table preview videos
│   ├── wheels/          # Wheel/logo images
│   ├── screenshots/     # Screenshots
│   └── audio/           # Music and sound files
├── pup/                 # PuP Packs
├── dmd/                 # DMD color files
├── config/              # Configuration files
├── scripts/             # Table scripts
└── backups/             # Backup files
```

## Smart Detection Features

### Table Name Detection
TiLT automatically extracts clean table names from filenames:

- `Medieval_Madness_1.09.vpx` → "Medieval Madness"
- `Attack_From_Mars_(Bally_1995)_v1.13.vpx` → "Attack From Mars"
- `TZ_94H_Final.vpx` → "TZ"

### ROM Name Detection
When importing a table, TiLT can detect the associated ROM name:

- `MedievalMadness.vpx` → Looks for `mm_109.zip`
- `AttackFromMars.vpx` → Looks for `afm_113.zip`

This helps match tables with their ROMs automatically.

## ZIP File Organization

For best results, organize your ZIP files like this:

### Single Table Pack
```
MedievalMadness.zip
├── MedievalMadness.vpx
├── mm_109.zip
├── MedievalMadness.directb2s
├── MedievalMadness.png
├── MedievalMadness.mp4
└── MedievalMadness_wheel.png
```

### Multi-Table Pack
```
Williams_Collection.zip
├── tables/
│   ├── MedievalMadness.vpx
│   └── AttackFromMars.vpx
├── roms/
│   ├── mm_109.zip
│   └── afm_113.zip
├── backglasses/
│   ├── MedievalMadness.directb2s
│   └── AttackFromMars.directb2s
└── media/
    ├── MedievalMadness.png
    └── AttackFromMars.png
```

Both formats work! TiLT intelligently detects the structure.

## Troubleshooting

### "File already exists" error
**Solution:** Enable "Overwrite existing" option or use `-o` flag:
```bash
tilt-import -o MyTable.zip
```

### "Invalid ZIP file" error
**Cause:** The file is corrupted or not a valid ZIP
**Solution:** Re-download the file or check if it's actually a ZIP

### Files imported to wrong locations
**Cause:** File type not recognized
**Solution:**
1. Check file extension matches supported types
2. Manually move files after import
3. Report the file type for future support

### Import very slow
**Cause:** Large video files or many files
**Solution:** This is normal. Progress bar shows status.

### Backups filling up disk space
**Solution:** Periodically clean backup folder:
```bash
rm -rf data/backups/*
```

## Batch Import Script

For power users, here's a script to watch a folder and auto-import:

```bash
#!/bin/bash
# auto-import.sh - Watch folder and auto-import ZIPs

WATCH_DIR="$HOME/Downloads"
IMPORT_DIR="$HOME/TiLT/data"

inotifywait -m -e close_write --format '%f' "$WATCH_DIR" | \
while read filename; do
    if [[ "$filename" == *.zip ]]; then
        echo "Auto-importing: $filename"
        tilt-import -y -b "$IMPORT_DIR" "$WATCH_DIR/$filename"
    fi
done
```

Make executable and run:
```bash
chmod +x auto-import.sh
./auto-import.sh
```

## Integration with TiLT

After importing, your content is immediately available in TiLT:

1. **Tables** appear in the table browser
2. **ROMs** are automatically associated with tables
3. **Backglasses** load when tables start
4. **Media** displays in the frontend
5. **PuP Packs** activate during gameplay

## API Usage

For developers integrating import functionality:

```cpp
#include "tools/import_manager.hpp"

// Create import manager
tilt::ImportManager importer;

// Configure
importer.setBasePath("./data");
importer.setAutoOrganize(true);
importer.setCreateBackups(true);

// Set progress callback
importer.setProgressCallback([](int current, int total, const std::string& file) {
    std::cout << "Progress: " << current << "/" << total << " - " << file << std::endl;
});

// Import file
importer.importZipFile("MyTable.zip");

// Import multiple files
std::vector<std::string> files = {"table1.zip", "table2.zip", "table3.zip"};
importer.importMultipleZips(files);

// Import directory
importer.importDirectory("~/Downloads");
```

## Best Practices

1. ✅ **Always preview** before importing large packs
2. ✅ **Keep backups enabled** for safety
3. ✅ **Organize downloads** in a dedicated folder
4. ✅ **Name files clearly** for easier management
5. ✅ **Use batch import** for multiple files
6. ✅ **Clean backups** periodically to save space

## FAQ

**Q: Can I import non-ZIP files?**
A: Not directly. ZIP files are required for organized importing. You can manually copy individual files to the appropriate folders.

**Q: What happens if a ZIP contains both a table and its ROM?**
A: Both are imported! TiLT detects each file type and places them correctly.

**Q: Can I undo an import?**
A: If backups are enabled, you can restore from `data/backups/`. Otherwise, manually remove imported files.

**Q: Does import work offline?**
A: Yes! Import is completely offline and local.

**Q: Can I customize where files are imported?**
A: Yes, use the `-b` flag or change the base path in settings.

**Q: Will this work with Baller Installer packs?**
A: Yes! TiLT's import system is compatible with Baller Installer ZIP structure.

## Getting Help

- Check the [main README](README.md)
- Visit the [forum](https://forum.tilt.example.com)
- Join our [Discord](https://discord.gg/tilt)
- Report issues on [GitHub](https://github.com/yourusername/TiLT/issues)

---

**Happy Importing! 🎮**
