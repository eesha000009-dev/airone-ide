/**
 * Airone AI Backbone - Preload Script
 * Exposes safe IPC methods to the renderer process via contextBridge.
 * This is the secure way to communicate between main and renderer in Electron.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('aironeAPI', {

  // ==================== ROBOT OPERATIONS ====================
  
  createRobot: (robotData) => ipcRenderer.invoke('db:createRobot', robotData),
  getRobot: (id) => ipcRenderer.invoke('db:getRobot', id),
  getRobotByName: (name) => ipcRenderer.invoke('db:getRobotByName', name),
  getAllRobots: () => ipcRenderer.invoke('db:getAllRobots'),
  updateRobot: (id, robotData) => ipcRenderer.invoke('db:updateRobot', id, robotData),
  deleteRobot: (id) => ipcRenderer.invoke('db:deleteRobot', id),

  // ==================== PIN OPERATIONS ====================
  
  syncPins: (robotId, pins) => ipcRenderer.invoke('db:syncPins', robotId, pins),
  getPins: (robotId) => ipcRenderer.invoke('db:getPins', robotId),
  updatePinDescription: (pinId, description) => ipcRenderer.invoke('db:updatePinDescription', pinId, description),
  parseAiroFile: (filePath) => ipcRenderer.invoke('file:parseAiro', filePath),

  // ==================== COMMAND LOG OPERATIONS ====================
  
  getCommandLogs: (robotId, limit) => ipcRenderer.invoke('db:getCommandLogs', robotId, limit),
  clearCommandLogs: (robotId) => ipcRenderer.invoke('db:clearCommandLogs', robotId),

  // ==================== AI CONFIG OPERATIONS ====================
  
  saveAiConfig: (robotId, config) => ipcRenderer.invoke('db:saveAiConfig', robotId, config),
  getActiveAiConfig: (robotId) => ipcRenderer.invoke('db:getActiveAiConfig', robotId),

  // ==================== BRAIN SERVER OPERATIONS ====================
  
  startBrainServer: (port, host) => ipcRenderer.invoke('brain:start', port, host),
  stopBrainServer: () => ipcRenderer.invoke('brain:stop'),
  getBrainServerStatus: () => ipcRenderer.invoke('brain:status'),
  emergencyStop: (robotId) => ipcRenderer.invoke('brain:emergencyStop', robotId),
  releaseEmergencyStop: (robotId) => ipcRenderer.invoke('brain:releaseEmergencyStop', robotId),

  // ==================== FILE OPERATIONS ====================
  
  openAiroFile: () => ipcRenderer.invoke('file:openAiro'),

  // ==================== EVENT LISTENERS ====================
  
  onBrainEvent: (callback) => {
    ipcRenderer.on('brain:event', (_event, data) => callback(data));
  },
  onSensorData: (callback) => {
    ipcRenderer.on('brain:sensorData', (_event, data) => callback(data));
  },
  onCommandSent: (callback) => {
    ipcRenderer.on('brain:commandSent', (_event, data) => callback(data));
  },
  onConnectionChange: (callback) => {
    ipcRenderer.on('brain:connectionChange', (_event, data) => callback(data));
  },

  // Remove event listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
