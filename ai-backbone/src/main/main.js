/**
 * Airone AI Backbone - Main Process
 * Electron main process that creates the browser window,
 * sets up IPC handlers, starts the brain server, and manages
 * the application lifecycle.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const brainServer = require('./brain-server');

let mainWindow = null;

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Airone AI Backbone',
    backgroundColor: '#0a0e27',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '../../build/icon.png'),
    show: false // Show when ready
  });

  // Load the renderer
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:9000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Load from built files
    const rendererPath = path.join(__dirname, '../renderer/dist/index.html');
    mainWindow.loadFile(rendererPath);
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Set up brain server event forwarding to renderer
  brainServer.setEventCallback((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Route events to specific channels for the renderer
      switch (event.type) {
        case 'sensor:data':
          mainWindow.webContents.send('brain:sensorData', event);
          break;
        case 'command:sent':
          mainWindow.webContents.send('brain:commandSent', event);
          break;
        case 'client:connected':
        case 'client:disconnected':
          mainWindow.webContents.send('brain:connectionChange', event);
          break;
        default:
          mainWindow.webContents.send('brain:event', event);
          break;
      }
    }
  });
}

/**
 * Set up the application menu
 */
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Import .airo File',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleOpenAiroFile()
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Airone AI Backbone',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'Airone AI Backbone v0.1.0',
              detail: 'Desktop application for robot AI control.\nPart of the Airone Robotics System.'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Handle opening .airo files
 */
async function handleOpenAiroFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import .airo File',
    filters: [
      { name: 'Airone Robot Files', extensions: ['airo'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  const pins = db.parseAiroPins(content);
  
  return { filePath, content, pins };
}

// ==================== IPC HANDLERS ====================

function setupIpcHandlers() {
  // ---- Robot Operations ----
  ipcMain.handle('db:createRobot', async (_event, robotData) => {
    return db.createRobot(robotData);
  });

  ipcMain.handle('db:getRobot', async (_event, id) => {
    return db.getRobot(id);
  });

  ipcMain.handle('db:getRobotByName', async (_event, name) => {
    return db.getRobotByName(name);
  });

  ipcMain.handle('db:getAllRobots', async () => {
    return db.getAllRobots();
  });

  ipcMain.handle('db:updateRobot', async (_event, id, robotData) => {
    return db.updateRobot(id, robotData);
  });

  ipcMain.handle('db:deleteRobot', async (_event, id) => {
    return db.deleteRobot(id);
  });

  // ---- Pin Operations ----
  ipcMain.handle('db:syncPins', async (_event, robotId, pins) => {
    return db.syncPins(robotId, pins);
  });

  ipcMain.handle('db:getPins', async (_event, robotId) => {
    return db.getPins(robotId);
  });

  ipcMain.handle('db:updatePinDescription', async (_event, pinId, description) => {
    return db.updatePinDescription(pinId, description);
  });

  ipcMain.handle('file:parseAiro', async (_event, filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, pins: db.parseAiroPins(content) };
  });

  // ---- Command Log Operations ----
  ipcMain.handle('db:getCommandLogs', async (_event, robotId, limit) => {
    return db.getCommandLogs(robotId, limit);
  });

  ipcMain.handle('db:clearCommandLogs', async (_event, robotId) => {
    return db.clearCommandLogs(robotId);
  });

  // ---- AI Config Operations ----
  ipcMain.handle('db:saveAiConfig', async (_event, robotId, config) => {
    return db.saveAiConfig(robotId, config);
  });

  ipcMain.handle('db:getActiveAiConfig', async (_event, robotId) => {
    return db.getActiveAiConfig(robotId);
  });

  // ---- Brain Server Operations ----
  ipcMain.handle('brain:start', async (_event, port, host) => {
    return brainServer.start(port, host);
  });

  ipcMain.handle('brain:stop', async () => {
    return brainServer.stop();
  });

  ipcMain.handle('brain:status', async () => {
    return brainServer.getStatus();
  });

  ipcMain.handle('brain:emergencyStop', async (_event, robotId) => {
    return brainServer.emergencyStop(robotId);
  });

  ipcMain.handle('brain:releaseEmergencyStop', async (_event, robotId) => {
    return brainServer.releaseEmergencyStop(robotId);
  });

  // ---- File Operations ----
  ipcMain.handle('file:openAiro', async () => {
    return handleOpenAiroFile();
  });
}

// ==================== APP LIFECYCLE ====================

app.whenReady().then(async () => {
  // Initialize database (async for sql.js)
  await db.initDatabase();

  // Set up IPC handlers
  setupIpcHandlers();

  // Create window
  createWindow();

  // Create menu
  createMenu();

  // Start brain server automatically
  const defaultPort = parseInt(process.env.BRAIN_PORT || '8080', 10);
  brainServer.start(defaultPort, '0.0.0.0');
  console.log(`[Main] Brain server auto-started on port ${defaultPort}`);

  // macOS: recreate window when dock icon clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup on quit
app.on('before-quit', () => {
  console.log('[Main] Shutting down...');
  brainServer.stop();
  db.closeDatabase();
});

// Security: Prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
