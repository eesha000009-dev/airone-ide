/**
 * Airone AI Backbone - Main Process
 * Electron main process with IPC handlers for:
 * - Robot/Pin/Config CRUD operations
 * - AI Chat (Kimi K2.6)
 * - LNN Generation + Training + Verification (multi-step)
 * - Multi-model deployment to Render
 * - Brain server with LNN model registration
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const brainServer = require('./brain-server');
const nvidiaClient = require('./nvidia-client');
const renderClient = require('./render-client');

let mainWindow = null;
let lastSyncedData = null;

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
    show: false
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:9000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const rendererPath = path.join(__dirname, '../renderer/dist/index.html');
    mainWindow.loadFile(rendererPath);
  }

  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });

  // Forward brain server events to renderer
  brainServer.setEventCallback((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
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

// ---- HTTP API Server for IDE sync ----
const http = require('http');
const SYNC_PORT = 8080;

function startSyncServer() {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/pins/sync') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log('[SyncServer] Received pin sync:', data.robotName, 
            data.pinDefinitions?.inputs?.length || 0, 'inputs,', 
            data.pinDefinitions?.outputs?.length || 0, 'outputs');

          // Store synced data for the frontend to pick up
          lastSyncedData = data;

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pins:synced', data);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Pins synced successfully' }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: err.message }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'airone-ai-backbone' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(SYNC_PORT, () => {
    console.log(`[SyncServer] Listening on port ${SYNC_PORT} for IDE sync`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[SyncServer] Port ${SYNC_PORT} already in use, skipping sync server`);
    } else {
      console.error('[SyncServer] Error:', err.message);
    }
  });
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Import .airo File', accelerator: 'CmdOrCtrl+O', click: () => handleOpenAiroFile() },
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
        { label: 'About Airone AI Backbone', click: () => { dialog.showMessageBox(mainWindow, { type: 'info', title: 'About', message: 'Airone AI Backbone v0.2.0', detail: 'Multi-model LNN robot control.\nPart of the Airone Robotics System.' }); } }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function handleOpenAiroFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import .airo File',
    filters: [{ name: 'Airone Robot Files', extensions: ['airo'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  const { pins, robotName } = db.parseAiroPins(content);
  return { filePath, content, pins, robotName };
}

// ==================== IPC HANDLERS ====================

function setupIpcHandlers() {
  // ---- Robot Operations ----
  ipcMain.handle('db:createRobot', async (_e, d) => db.createRobot(d));
  ipcMain.handle('db:getRobot', async (_e, id) => db.getRobot(id));
  ipcMain.handle('db:getRobotByName', async (_e, name) => db.getRobotByName(name));
  ipcMain.handle('db:getAllRobots', async () => db.getAllRobots());
  ipcMain.handle('db:updateRobot', async (_e, id, d) => db.updateRobot(id, d));
  ipcMain.handle('db:deleteRobot', async (_e, id) => db.deleteRobot(id));

  // ---- Pin Operations ----
  ipcMain.handle('db:syncPins', async (_e, robotId, pins) => db.syncPins(robotId, pins));
  ipcMain.handle('db:getPins', async (_e, robotId) => db.getPins(robotId));
  ipcMain.handle('db:updatePinDescription', async (_e, pinId, desc) => db.updatePinDescription(pinId, desc));
  ipcMain.handle('pins:getSynced', async () => lastSyncedData);
  ipcMain.handle('file:parseAiro', async (_e, filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, ...db.parseAiroPins(content) };
  });

  // ---- Command Log Operations ----
  ipcMain.handle('db:getCommandLogs', async (_e, robotId, limit) => db.getCommandLogs(robotId, limit));
  ipcMain.handle('db:clearCommandLogs', async (_e, robotId) => db.clearCommandLogs(robotId));

  // ---- AI Config Operations ----
  ipcMain.handle('db:saveAiConfig', async (_e, robotId, config) => db.saveAiConfig(robotId, config));
  ipcMain.handle('db:getActiveAiConfig', async (_e, robotId) => db.getActiveAiConfig(robotId));

  // ---- Brain Server Operations ----
  ipcMain.handle('brain:start', async (_e, port, host) => brainServer.start(port, host));
  ipcMain.handle('brain:stop', async () => brainServer.stop());
  ipcMain.handle('brain:status', async () => brainServer.getStatus());
  ipcMain.handle('brain:emergencyStop', async (_e, robotId) => brainServer.emergencyStop(robotId));
  ipcMain.handle('brain:releaseEmergencyStop', async (_e, robotId) => brainServer.releaseEmergencyStop(robotId));

  // ---- File Operations ----
  ipcMain.handle('file:openAiro', async () => handleOpenAiroFile());

  // ---- AI Chat Operations ----
  ipcMain.handle('ai:sendChat', async (_event, { robotId, messages, pins, robotData }) => {
    try {
      for (const msg of messages) {
        if (msg.role === 'user') db.saveChatMessage(robotId, 'user', msg.content);
      }
      const assistantContent = await nvidiaClient.sendChatCompletion({ messages, model: robotData?.ai_model });
      db.saveChatMessage(robotId, 'assistant', assistantContent);
      return { content: assistantContent, role: 'assistant' };
    } catch (err) {
      throw new Error(`AI chat failed: ${err.message}`);
    }
  });

  // ---- LNN Model Generation (Legacy - no training) ----
  ipcMain.handle('ai:generateLnnModel', async (_event, { robotId, robotData, pins, messages }) => {
    try {
      const modelConfig = await nvidiaClient.generateLnnModel({ robotData, pins, conversationHistory: messages || [] });
      const savedModel = db.saveLnnModel(robotId, modelConfig);
      return { modelConfig, modelId: savedModel.id };
    } catch (err) {
      throw new Error(`LNN model generation failed: ${err.message}`);
    }
  });

  // ---- LNN Generation + Training + Verification (Full Pipeline) ----
  ipcMain.handle('ai:generateLnnModelStream', async (event, params) => {
    const { robotId, robotData, pins, messages } = params;

    try {
      // Run the full pipeline: Generate → Train Data → Train → Verify
      const result = await nvidiaClient.generateAndTrainLnn(
        { robotData, pins, conversationHistory: messages || [] },
        (progressData) => {
          // Forward progress to renderer
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai:generateProgress', progressData);
          }
        }
      );

      // Save the trained model to database
      if (robotId && result.modelConfig) {
        try {
          const savedModel = db.saveLnnModel(robotId, result.modelConfig);
          result.modelId = savedModel.id;

          // Also register the model with the local brain server
          brainServer.registerLnnModel(robotData?.name || 'default', result.modelConfig);
        } catch (e) {
          console.warn('[Main] Failed to save LNN model:', e.message);
        }
      }

      return {
        status: 'generated',
        model_id: result.modelId || `lnn-${Date.now()}`,
        config: result.modelConfig,
        accuracy: result.accuracy,
        verification: result.verification,
        training_info: result.modelConfig?.training_info || null
      };
    } catch (err) {
      console.error('[Main] LNN generation pipeline error:', err.message);

      // Fallback: try non-streaming generate without training
      try {
        const modelConfig = await nvidiaClient.generateLnnModel({
          robotData,
          pins,
          conversationHistory: messages || []
        });

        const savedModel = db.saveLnnModel(robotId, modelConfig);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai:generateProgress', {
            step: 'complete',
            progress: 100,
            model_id: savedModel.id,
            config: modelConfig,
            accuracy: null
          });
        }

        return {
          status: 'generated',
          model_id: savedModel.id,
          config: modelConfig,
          accuracy: null,
          training_info: null
        };
      } catch (e2) {
        throw new Error(`Generation failed: ${err.message}`);
      }
    }
  });

  ipcMain.handle('ai:getChatHistory', async (_e, robotId) => db.getChatHistory(robotId));
  ipcMain.handle('ai:clearChatHistory', async (_e, robotId) => db.clearChatHistory(robotId));

  // ---- Deploy Operations (Multi-Model) ----
  ipcMain.handle('deploy:brainService', async (_event, { robotId, modelConfig }) => {
    try {
      const robot = db.getRobot(robotId);
      if (!robot) throw new Error('Robot not found');

      const latestModel = db.getLatestLnnModel(robotId);
      if (latestModel) db.updateLnnModelStatus(latestModel.id, 'deploying');

      // Get the model config to deploy - prefer passed config, then latest from DB
      let configToDeploy = modelConfig || (latestModel?.model_config);
      if (!configToDeploy) throw new Error('No model config available to deploy');

      // Ensure output_types is present in the config
      if (configToDeploy.input_size !== undefined && (!configToDeploy.output_types || Object.keys(configToDeploy.output_types).length === 0)) {
        // Infer output_types from output_mapping keys
        const outputTypes = {};
        for (const name of Object.keys(configToDeploy.output_mapping || {})) {
          const desc = (name || '').toLowerCase();
          if (desc.includes('motor') || desc.includes('speed') || desc.includes('pwm')) {
            outputTypes[name] = 'pwm';
          } else if (desc.includes('servo') || desc.includes('angle') || desc.includes('arm') || desc.includes('hand') || desc.includes('leg')) {
            outputTypes[name] = 'servo';
          } else {
            outputTypes[name] = 'digital';
          }
        }
        configToDeploy.output_types = outputTypes;
        console.log('[Main] Inferred output_types for deploy:', JSON.stringify(outputTypes));
      }

      // Deploy to the existing brain-template service (multi-model)
      const deployResult = await renderClient.deployBrainService({
        robotId,
        robotName: robot.name,
        modelConfig: configToDeploy
      });

      if (latestModel) {
        db.updateLnnModelStatus(
          latestModel.id,
          'deployed',
          deployResult.brain_url,
          deployResult.api_key,
          deployResult.service_id
        );
      }

      db.updateRobot(robotId, {
        brain_url: deployResult.brain_url,
        api_key: deployResult.api_key
      });

      return deployResult;
    } catch (err) {
      const latestModel = db.getLatestLnnModel(robotId);
      if (latestModel) db.updateLnnModelStatus(latestModel.id, 'failed');
      throw new Error(`Brain service deployment failed: ${err.message}`);
    }
  });

  ipcMain.handle('deploy:getStatus', async (_e, serviceId) => {
    try {
      return await renderClient.getServiceStatus(serviceId);
    } catch (err) {
      throw new Error(`Failed to get deploy status: ${err.message}`);
    }
  });

  // ---- Brain Health Check ----
  ipcMain.handle('deploy:brainHealth', async () => {
    try {
      return await renderClient.getBrainHealth();
    } catch (err) {
      throw new Error(`Brain health check failed: ${err.message}`);
    }
  });

  // ---- LNN Model Operations ----
  ipcMain.handle('db:getLnnModels', async (_e, robotId) => db.getLnnModels(robotId));
  ipcMain.handle('db:getLatestLnnModel', async (_e, robotId) => db.getLatestLnnModel(robotId));

  // ---- Register LNN model with local brain server ----
  ipcMain.handle('brain:registerLnnModel', async (_e, robotName, modelConfig) => {
    brainServer.registerLnnModel(robotName, modelConfig);
    return { success: true, models: Array.from(brainServer.lnnModels.keys()) };
  });
}

// ==================== APP LIFECYCLE ====================

app.whenReady().then(async () => {
  await db.initDatabase();
  setupIpcHandlers();
  createWindow();
  createMenu();
  startSyncServer();

  const defaultPort = parseInt(process.env.BRAIN_PORT || '8080', 10);
  brainServer.start(defaultPort, '0.0.0.0');
  console.log(`[Main] Brain server auto-started on port ${defaultPort}`);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { brainServer.stop(); db.closeDatabase(); });
app.on('web-contents-created', (_e, contents) => { contents.setWindowOpenHandler(() => ({ action: 'deny' })); });
