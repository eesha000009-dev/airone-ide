/**
 * Airone AI Backbone - Database Module
 * SQLite database using sql.js (WASM-based, no native compilation needed).
 * Stores robot configurations, pin definitions, command logs, and AI configuration.
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

  db.run('CREATE INDEX IF NOT EXISTS idx_pins_robot ON pin_definitions(robot_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_logs_robot ON command_logs(robot_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON command_logs(timestamp DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ai_config_robot ON ai_config(robot_id)');

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
  
  const allowedFields = ['name', 'type', 'purpose', 'environment', 'brain_url', 'ai_model'];
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
 * Parse .airo file and extract pin definitions
 * Format: pin defi { name = number; mode. }
 */
function parseAiroPins(content) {
  const pins = [];
  
  // Match "pin defi { ... }" block
  const pinDefiMatch = content.match(/pin\s+defi\s*\{([^}]+)\}/s);
  if (!pinDefiMatch) return pins;
  
  const block = pinDefiMatch[1];
  
  // Parse each line: name = number; mode.
  const lineRegex = /(\w+)\s*=\s*(\d+)\s*;\s*(input|output)\s*\./g;
  let match;
  while ((match = lineRegex.exec(block)) !== null) {
    pins.push({
      name: match[1],
      number: parseInt(match[2], 10),
      mode: match[3],
      description: ''
    });
  }
  
  return pins;
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
  getActiveAiConfig
};
