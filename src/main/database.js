/**
 * Airone AI Backbone - Database Module
 * SQLite database using sql.js (WASM-based, no native compilation needed).
 * Stores robot configurations, pin definitions, command logs, AI configuration,
 * LNN models, and chat history.
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');

let db = null;
let dbPath = null;

/**
 * Initialize the database connection and create tables
 */
async function initDatabase(customDbPath) {
  dbPath = customDbPath || path.join(app.getPath('userData'), 'airone.db');

  const SQL = await initSqlJs();

  // Load existing database file if it exists
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS robots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Custom',
      purpose TEXT DEFAULT '',
      environment TEXT DEFAULT '',
      brain_url TEXT DEFAULT '',
      ai_model TEXT DEFAULT 'rule-based',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pin_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      robot_id TEXT NOT NULL,
      pin_name TEXT NOT NULL,
      pin_number INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'output',
      description TEXT DEFAULT '',
      FOREIGN KEY (robot_id) REFERENCES robots(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS command_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      robot_id TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'received',
      command TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (robot_id) REFERENCES robots(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      robot_id TEXT NOT NULL,
      model_type TEXT NOT NULL DEFAULT 'rule-based',
      api_key TEXT DEFAULT '',
      endpoint TEXT DEFAULT '',
      config_json TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (robot_id) REFERENCES robots(id) ON DELETE CASCADE
    )
  `);

  // New tables: LNN models and chat history
  db.run(`
    CREATE TABLE IF NOT EXISTS lnn_models (
      id TEXT PRIMARY KEY,
      robot_id TEXT NOT NULL,
      model_config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generated',
      brain_url TEXT DEFAULT '',
      brain_api_key TEXT DEFAULT '',
      render_service_id TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (robot_id) REFERENCES robots(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      robot_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (robot_id) REFERENCES robots(id) ON DELETE CASCADE
    )
  `);

  // Add indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_pins_robot ON pin_definitions(robot_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_logs_robot ON command_logs(robot_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON command_logs(timestamp DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ai_config_robot ON ai_config(robot_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_lnn_models_robot ON lnn_models(robot_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_lnn_models_status ON lnn_models(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_chat_history_robot ON chat_history(robot_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp ON chat_history(timestamp DESC)');

  // Try to add api_key column to robots table (may already exist in older DBs)
  try {
    db.run('ALTER TABLE robots ADD COLUMN api_key TEXT DEFAULT \'\'');
  } catch (_alterErr) {
    // Column already exists — ignore
  }

  saveDatabase();
  console.log(`[Database] Initialized at ${dbPath}`);
  return db;
}

/**
 * Save the database to disk
 */
function saveDatabase() {
  if (db && dbPath) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      // Ensure directory exists
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(dbPath, buffer);
    } catch (err) {
      console.error('[Database] Failed to save:', err.message);
    }
  }
}

/**
 * Get the database instance (initialize if needed)
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Helper: run a query and return results as array of objects
 */
function queryAll(sql, params = []) {
  const d = getDb();
  const stmt = d.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

/**
 * Helper: run a query and return first result or undefined
 */
function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : undefined;
}

/**
 * Helper: run a statement (INSERT, UPDATE, DELETE) and save
 */
function runStatement(sql, params = []) {
  const d = getDb();
  d.run(sql, params);
  saveDatabase();
}

// ==================== ROBOT OPERATIONS ====================

function createRobot(robotData) {
  const id = uuidv4();
  runStatement(`
    INSERT INTO robots (id, name, type, purpose, environment, brain_url, ai_model)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    robotData.name || 'Unnamed Robot',
    robotData.type || 'Custom',
    robotData.purpose || '',
    robotData.environment || '',
    robotData.brain_url || '',
    robotData.ai_model || 'rule-based'
  ]);
  return { id, ...robotData };
}

function getRobot(id) {
  return queryOne('SELECT * FROM robots WHERE id = ?', [id]) || null;
}

function getRobotByName(name) {
  return queryOne('SELECT * FROM robots WHERE name = ?', [name]) || null;
}

function getAllRobots() {
  return queryAll('SELECT * FROM robots ORDER BY updated_at DESC');
}

function updateRobot(id, robotData) {
  const fields = [];
  const values = [];
  
  const allowedFields = ['name', 'type', 'purpose', 'environment', 'brain_url', 'ai_model', 'api_key'];
  for (const field of allowedFields) {
    if (robotData[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(robotData[field]);
    }
  }
  
  if (fields.length === 0) return null;
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  runStatement(`UPDATE robots SET ${fields.join(', ')} WHERE id = ?`, values);
  return getRobot(id);
}

function deleteRobot(id) {
  runStatement('DELETE FROM robots WHERE id = ?', [id]);
  return { deleted: true };
}

// ==================== PIN DEFINITION OPERATIONS ====================

function syncPins(robotId, pins) {
  const d = getDb();
  
  // Clear old pins
  d.run('DELETE FROM pin_definitions WHERE robot_id = ?', [robotId]);
  
  // Insert new pins
  for (const pin of pins) {
    d.run(
      'INSERT INTO pin_definitions (robot_id, pin_name, pin_number, mode, description) VALUES (?, ?, ?, ?, ?)',
      [
        robotId,
        pin.name || pin.pin_name,
        pin.number || pin.pin_number,
        pin.mode || 'output',
        pin.description || ''
      ]
    );
  }
  
  saveDatabase();
  return pins.length;
}

function getPins(robotId) {
  return queryAll('SELECT * FROM pin_definitions WHERE robot_id = ? ORDER BY pin_number', [robotId]);
}

function updatePinDescription(pinId, description) {
  runStatement('UPDATE pin_definitions SET description = ? WHERE id = ?', [description, pinId]);
  return { updated: true };
}

/**
 * Parse .airo file and extract pin definitions and robot name.
 * Format: pin defi { name = number; mode. }
 * Enhanced regex supports: input, output, in, out, analog, pwm modes.
 *
 * @param {string} content - The .airo file content
 * @returns {Object} { pins: Array, robotName: string }
 */
function parseAiroPins(content) {
  const pins = [];
  let robotName = '';

  // Extract robot name from the .airo content
  // Look for patterns like: robot Name, robot "Name", name = "Name", name: Name, etc.
  const namePatterns = [
    /robot\s+"([^"]+)"/i,
    /robot\s+'([^']+)'/i,
    /robot\s+(\w+)/i,
    /name\s*=\s*"([^"]+)"/i,
    /name\s*=\s*'([^']+)'/i,
    /name\s*:\s*"([^"]+)"/i,
    /name\s*:\s*'([^']+)'/i,
    /name\s*:\s*(\w+)/i
  ];

  for (const pattern of namePatterns) {
    const match = content.match(pattern);
    if (match) {
      robotName = match[1];
      break;
    }
  }

  // Match "pin defi { ... }" block
  const pinDefiMatch = content.match(/pin\s+defi?[a-z]*\s*\{([^}]+)\}/is);
  if (!pinDefiMatch) return { pins, robotName };

  const block = pinDefiMatch[1];

  // Mode normalization map
  const modeNormalization = {
    'input': 'input',
    'in': 'input',
    'analog': 'analog',
    'output': 'output',
    'out': 'output',
    'pwm': 'pwm'
  };

  // Parse each line: name = number; mode.
  // Enhanced regex supports: input, output, in, out, analog, pwm
  const lineRegex = /(\w+)\s*=\s*(\d+)\s*[;,]\s*(input|output|in|out|analog|pwm)\s*[.;,]?\s*$/gim;
  let match;
  while ((match = lineRegex.exec(block)) !== null) {
    const rawMode = match[3].toLowerCase();
    const normalizedMode = modeNormalization[rawMode] || rawMode;
    pins.push({
      name: match[1],
      number: parseInt(match[2], 10),
      mode: normalizedMode,
      description: ''
    });
  }

  return { pins, robotName };
}

// ==================== COMMAND LOG OPERATIONS ====================

function addCommandLog(robotId, direction, command) {
  const cmdStr = typeof command === 'string' ? command : JSON.stringify(command);
  runStatement(
    'INSERT INTO command_logs (robot_id, direction, command) VALUES (?, ?, ?)',
    [robotId, direction, cmdStr]
  );
  // Get the last inserted ID
  const row = queryOne('SELECT last_insert_rowid() as id');
  return { id: row?.id, robotId, direction, command: cmdStr };
}

function getCommandLogs(robotId, limit = 100) {
  return queryAll(
    'SELECT * FROM command_logs WHERE robot_id = ? ORDER BY timestamp DESC LIMIT ?',
    [robotId, limit]
  );
}

function clearCommandLogs(robotId) {
  runStatement('DELETE FROM command_logs WHERE robot_id = ?', [robotId]);
  return { cleared: true };
}

// ==================== AI CONFIG OPERATIONS ====================

function saveAiConfig(robotId, config) {
  // Deactivate existing configs
  runStatement('UPDATE ai_config SET is_active = 0 WHERE robot_id = ?', [robotId]);
  
  // Insert new config
  runStatement(`
    INSERT INTO ai_config (robot_id, model_type, api_key, endpoint, config_json, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `, [
    robotId,
    config.model_type || 'rule-based',
    config.api_key || '',
    config.endpoint || '',
    JSON.stringify(config.config_json || {})
  ]);
  
  return getActiveAiConfig(robotId);
}

function getActiveAiConfig(robotId) {
  const row = queryOne(
    'SELECT * FROM ai_config WHERE robot_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
    [robotId]
  );
  if (row && row.config_json) {
    try {
      row.config_json = JSON.parse(row.config_json);
    } catch (e) {
      row.config_json = {};
    }
  }
  return row || null;
}

// ==================== LNN MODEL OPERATIONS ====================

/**
 * Save a new LNN model for a robot.
 * @param {string} robotId - The robot's database ID
 * @param {Object} modelConfig - The LNN model configuration object
 * @returns {Object} The saved model record { id, robot_id, model_config, status, ... }
 */
function saveLnnModel(robotId, modelConfig) {
  const id = uuidv4();
  const configStr = typeof modelConfig === 'string' ? modelConfig : JSON.stringify(modelConfig);

  runStatement(`
    INSERT INTO lnn_models (id, robot_id, model_config, status)
    VALUES (?, ?, ?, 'generated')
  `, [id, robotId, configStr]);

  return {
    id,
    robot_id: robotId,
    model_config: modelConfig,
    status: 'generated',
    brain_url: '',
    brain_api_key: '',
    render_service_id: ''
  };
}

/**
 * Get all LNN models for a robot.
 * @param {string} robotId - The robot's database ID
 * @returns {Array} Array of model records
 */
function getLnnModels(robotId) {
  const rows = queryAll(
    'SELECT * FROM lnn_models WHERE robot_id = ? ORDER BY created_at DESC',
    [robotId]
  );
  // Parse model_config JSON
  return rows.map(row => {
    if (row.model_config && typeof row.model_config === 'string') {
      try {
        row.model_config = JSON.parse(row.model_config);
      } catch (_e) {
        // Keep as string if not parseable
      }
    }
    return row;
  });
}

/**
 * Get the most recent LNN model for a robot.
 * @param {string} robotId - The robot's database ID
 * @returns {Object|null} The latest model record or null
 */
function getLatestLnnModel(robotId) {
  const row = queryOne(
    'SELECT * FROM lnn_models WHERE robot_id = ? ORDER BY created_at DESC LIMIT 1',
    [robotId]
  );
  if (row && row.model_config && typeof row.model_config === 'string') {
    try {
      row.model_config = JSON.parse(row.model_config);
    } catch (_e) {
      // Keep as string if not parseable
    }
  }
  return row || null;
}

/**
 * Update an LNN model's status and deployment info.
 * @param {string} modelId - The model's ID
 * @param {string} status - New status (e.g., 'deploying', 'deployed', 'failed')
 * @param {string} [brainUrl] - The brain server WebSocket URL
 * @param {string} [brainApiKey] - The brain server API key
 * @param {string} [renderServiceId] - The Render service ID
 * @returns {Object} Updated model record or null
 */
function updateLnnModelStatus(modelId, status, brainUrl, brainApiKey, renderServiceId) {
  runStatement(`
    UPDATE lnn_models
    SET status = ?,
        brain_url = COALESCE(?, brain_url),
        brain_api_key = COALESCE(?, brain_api_key),
        render_service_id = COALESCE(?, render_service_id)
    WHERE id = ?
  `, [status, brainUrl || null, brainApiKey || null, renderServiceId || null, modelId]);

  return queryOne('SELECT * FROM lnn_models WHERE id = ?', [modelId]) || null;
}

// ==================== CHAT HISTORY OPERATIONS ====================

/**
 * Save a chat message for a robot.
 * @param {string} robotId - The robot's database ID
 * @param {string} role - Message role ('user', 'assistant', 'system')
 * @param {string} content - Message content
 * @returns {Object} The saved message record
 */
function saveChatMessage(robotId, role, content) {
  runStatement(`
    INSERT INTO chat_history (robot_id, role, content)
    VALUES (?, ?, ?)
  `, [robotId, role, content]);

  const row = queryOne('SELECT last_insert_rowid() as id');
  return {
    id: row?.id,
    robot_id: robotId,
    role,
    content,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get chat history for a robot.
 * @param {string} robotId - The robot's database ID
 * @param {number} [limit=200] - Maximum number of messages to return
 * @returns {Array} Array of chat messages (oldest first)
 */
function getChatHistory(robotId, limit = 200) {
  // Get messages ordered by timestamp ascending (oldest first for conversation flow)
  return queryAll(
    'SELECT * FROM chat_history WHERE robot_id = ? ORDER BY timestamp ASC LIMIT ?',
    [robotId, limit]
  );
}

/**
 * Clear all chat history for a robot.
 * @param {string} robotId - The robot's database ID
 * @returns {Object} { cleared: true }
 */
function clearChatHistory(robotId) {
  runStatement('DELETE FROM chat_history WHERE robot_id = ?', [robotId]);
  return { cleared: true };
}

// ==================== ROBOT LOOKUP BY API KEY ====================

/**
 * Find a robot by its API key.
 * @param {string} apiKey - The robot's API key
 * @returns {Object|null} The robot record or null
 */
function getRobotByApiKey(apiKey) {
  return queryOne('SELECT * FROM robots WHERE api_key = ?', [apiKey]) || null;
}

// ==================== CLEANUP ====================

function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    console.log('[Database] Closed');
  }
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  saveDatabase,
  // Robot operations
  createRobot,
  getRobot,
  getRobotByName,
  getAllRobots,
  updateRobot,
  deleteRobot,
  getRobotByApiKey,
  // Pin operations
  syncPins,
  getPins,
  updatePinDescription,
  parseAiroPins,
  // Command log operations
  addCommandLog,
  getCommandLogs,
  clearCommandLogs,
  // AI config operations
  saveAiConfig,
  getActiveAiConfig,
  // LNN model operations
  saveLnnModel,
  getLnnModels,
  getLatestLnnModel,
  updateLnnModelStatus,
  // Chat history operations
  saveChatMessage,
  getChatHistory,
  clearChatHistory
};
