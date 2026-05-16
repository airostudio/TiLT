/**
 * TiLT Electron main process
 *
 * Manages the launcher window and communicates with the tilt C++ binary
 * via a JSON-over-stdio IPC protocol.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Locate the tilt binary (bundled in production, built locally in dev)
function findTiltBinary() {
  const candidates = [
    path.join(process.resourcesPath, 'bin', 'tilt'),
    path.join(__dirname, '..', 'build', 'tilt'),
    path.join(__dirname, '..', 'build', 'Release', 'tilt'),
    path.join(__dirname, '..', 'build', 'tilt.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let mainWindow = null;
let engineProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    killEngine();
    mainWindow = null;
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Tables Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => chooseTablesFolder(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'GitHub',
          click: () => shell.openExternal('https://github.com/airostudio/tilt'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC: renderer → main ─────────────────────────────────────────────────────

ipcMain.handle('engine:status', async () => {
  const binary = findTiltBinary();
  return { available: !!binary, path: binary };
});

ipcMain.handle('engine:launch', async (_event, { tableFile, romName, renderer, vr }) => {
  return launchTable({ tableFile, romName, renderer, vr });
});

ipcMain.handle('engine:stop', async () => {
  killEngine();
  return { ok: true };
});

ipcMain.handle('dialog:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose tables folder',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:chooseFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Pinball Tables', extensions: ['vpx', 'fpt', 'fp'] }],
    title: 'Open table file',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('tables:scan', async (_event, folder) => {
  return scanTablesFolder(folder);
});

// ── Engine management ─────────────────────────────────────────────────────────

function launchTable({ tableFile, romName, renderer = 'opengl', vr = false }) {
  return new Promise((resolve, reject) => {
    if (engineProcess) {
      killEngine();
    }

    const binary = findTiltBinary();
    if (!binary) {
      return reject(new Error('tilt binary not found. Build the project first.'));
    }

    const args = ['--table', tableFile, '--renderer', renderer];
    if (romName) args.push('--rom', romName);
    if (vr) args.push('--vr');
    args.push('--ipc');

    engineProcess = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let resolved = false;

    engineProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (!resolved && msg.status === 'ready') {
            resolved = true;
            resolve({ ok: true, pid: engineProcess.pid });
          }
          // Forward engine events to renderer
          if (mainWindow) {
            mainWindow.webContents.send('engine:event', msg);
          }
        } catch {
          // Non-JSON output — forward as log line
          if (mainWindow) {
            mainWindow.webContents.send('engine:log', line);
          }
        }
      }
    });

    engineProcess.stderr.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('engine:log', data.toString());
      }
    });

    engineProcess.on('exit', (code) => {
      engineProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('engine:stopped', { code });
      }
      if (!resolved) {
        resolved = true;
        reject(new Error(`Engine exited with code ${code}`));
      }
    });

    // If no ready message in 5 s, resolve anyway (binary may not support IPC yet)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: true, pid: engineProcess?.pid });
      }
    }, 5000);
  });
}

function killEngine() {
  if (engineProcess) {
    engineProcess.kill();
    engineProcess = null;
  }
}

// ── Table scanning ────────────────────────────────────────────────────────────

const TABLE_EXTENSIONS = new Set(['.vpx', '.fpt', '.fp']);

function scanTablesFolder(folder) {
  if (!folder || !fs.existsSync(folder)) return [];

  const results = [];

  try {
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TABLE_EXTENSIONS.has(ext)) continue;

      const base = path.basename(entry.name, ext);
      results.push({
        name: humanizeName(base),
        filename: path.join(folder, entry.name),
        ext: ext.slice(1),
        thumbnailPath: '',
        wheelImagePath: '',
        videoPath: '',
        year: null,
        manufacturer: null,
        rating: null,
        playCount: 0,
      });
    }
  } catch (err) {
    console.error('Error scanning folder:', err);
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function humanizeName(filename) {
  return filename
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

async function chooseTablesFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose tables folder',
  });
  if (!result.canceled && mainWindow) {
    mainWindow.webContents.send('tables:folderSelected', result.filePaths[0]);
  }
}
