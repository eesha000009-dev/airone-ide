/**
 * Airone AI Backbone - Brain Server
 * Integrated WebSocket server that receives sensor data from robots,
 * processes it through the AI engine, and sends commands back.
 * 
 * Supports two message formats from robots:
 * 1. Natural Language Prompt (from ESP32 senddatato):
 *    "Currently, the input sensors read:
 *     (sensor: value, ...),
 *     What do you want to do to:
 *     (module1, module2, ...)."
 * 
 * 2. JSON (legacy/structured):
 *    {"robot_id": "...", "input_sensors_read": {...}, ...}
 * 
 * The brain always responds with JSON commands:
 *    {"output_commands": {"module_name": {"action": "...", "value": ...}}}
 * 
 * Features:
 * - WebSocket server for robot communication
 * - Rule-based processing engine (built-in)
 * - LLM integration support (OpenAI, Claude, local LLaMA)
 * - Command history logging to SQLite
 * - Event emission to Electron renderer for live monitoring
 * - Emergency stop capability
 */

const { WebSocketServer } = require('ws');
const axios = require('axios');
const db = require('./database');

class BrainServer {
  constructor() {
    this.wss = null;
    this.port = 8080;
    this.host = '0.0.0.0';
    this.running = false;
    this.robotConnections = new Map(); // robot_id -> ws
    this.emergencyStopped = new Set(); // robot_ids that are emergency stopped
    this.eventCallback = null; // callback to send events to renderer
    this.lastSensorData = new Map(); // robot_id -> last sensor data
    this.commandCounter = 0;
  }

  /**
   * Set callback for sending events to the renderer process
   */
  setEventCallback(callback) {
    this.eventCallback = callback;
  }

  /**
   * Emit an event to the renderer
   */
  emitEvent(eventType, data) {
    if (this.eventCallback) {
      this.eventCallback({ type: eventType, data, timestamp: Date.now() });
    }
  }

  // ==================================================================
  // NATURAL LANGUAGE PROMPT PARSER
  // ==================================================================

  /**
   * Parse the natural language prompt sent by the ESP32 via senddatato.
   * 
   * Format:
   *   Currently, the input sensors read:
   *   (sensor_name: value, sensor_name: value, ...),
   *   What do you want to do to:
   *   (output_module_1, output_module_2, ...).
   * 
   * Returns structured data:
   *   {
   *     input_sensors_read: { sensor_name: value, ... },
   *     output_modules_available: ["module1", "module2", ...],
   *     _raw_prompt: "the original text",
   *     _format: "natural_language"
   *   }
   */
  parseNaturalLanguagePrompt(text) {
    const result = {
      input_sensors_read: {},
      output_modules_available: [],
      _raw_prompt: text,
      _format: 'natural_language',
      ask_question: '',
      ask_context: ''
    };

    // Extract input sensors section
    // Pattern: "Currently, the input sensors read:\n(sensor_data),"
    const sensorsMatch = text.match(
      /Currently, the input sensors read:\s*\n?\s*\(([^)]*)\)/i
    );
    if (sensorsMatch) {
      const sensorText = sensorsMatch[1].trim();
      if (sensorText && !sensorText.toLowerCase().includes('no input sensors')) {
        // Parse "sensor_name: value, sensor_name: value"
        const pairs = sensorText.split(',');
        for (const pair of pairs) {
          const trimmed = pair.trim();
          if (trimmed.includes(':')) {
            const [key, ...valParts] = trimmed.split(':');
            let val = valParts.join(':').trim();
            // Try to convert to number
            const num = Number(val);
            if (!isNaN(num)) {
              val = num;
            }
            result.input_sensors_read[key.trim()] = val;
          }
        }
      }
    }

    // Extract output modules section
    // Pattern: "What do you want to do to:\n(module1, module2, ...)."
    const outputsMatch = text.match(
      /What do you want to do to:\s*\n?\s*\(([^)]*)\)/i
    );
    if (outputsMatch) {
      const outputText = outputsMatch[1].trim();
      if (outputText && !outputText.toLowerCase().includes('no output modules')) {
        const modules = outputText.split(',').map(m => m.trim().replace(/\./g, '')).filter(Boolean);
        result.output_modules_available = modules;
      }
    }

    // Extract ask() question if present
    const askMatch = text.match(/Also, the robot asks:\s*(.+?)(?:\s*\(Context:\s*(.+?)\))?$/im);
    if (askMatch) {
      result.ask_question = askMatch[1].trim();
      result.ask_context = askMatch[2] ? askMatch[2].trim() : '';
    }

    return result;
  }

  /**
   * Parse an incoming message from a robot.
   * Handles both JSON and natural language prompt formats.
   */
  parseMessage(rawMessage) {
    // Try JSON first
    try {
      const data = JSON.parse(rawMessage);
      if (typeof data === 'object' && data !== null) {
        return data;
      }
    } catch (e) {
      // Not JSON
    }

    // Not JSON — parse as natural language prompt
    console.log('[BrainServer] Received natural language prompt from robot');
    return this.parseNaturalLanguagePrompt(rawMessage);
  }

  // ==================================================================
  // SERVER LIFECYCLE
  // ==================================================================

  /**
   * Start the WebSocket brain server
   */
  start(port = 8080, host = '0.0.0.0') {
    if (this.running) {
      console.log('[BrainServer] Already running');
      return { success: false, error: 'Server already running' };
    }

    this.port = port;
    this.host = host;

    try {
      this.wss = new WebSocketServer({ port, host });

      this.wss.on('listening', () => {
        this.running = true;
        console.log(`[BrainServer] Listening on ws://${host}:${port}`);
        this.emitEvent('server:started', { port, host });
      });

      this.wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        console.log(`[BrainServer] Client connected from ${clientIp}`);
        this.emitEvent('client:connected', { ip: clientIp });

        let robotId = null;

        ws.on('message', async (rawData) => {
          try {
            const rawStr = rawData.toString();
            
            // Parse message (JSON or natural language prompt)
            const message = this.parseMessage(rawStr);
            
            robotId = message.robot_id;

            // For natural language prompts without robot_id, assign temporary ID
            if (!robotId) {
              robotId = `robot_${Date.now() % 10000}`;
              message.robot_id = robotId;
            }

            // Check emergency stop
            if (this.emergencyStopped.has(robotId)) {
              ws.send(JSON.stringify({
                command_id: `cmd_${++this.commandCounter}`,
                output_commands: { _emergency_stop: { action: 'halt', value: 1 } },
                metadata: { confidence: 1.0, reasoning: 'Emergency stop active' }
              }));
              return;
            }

            // Store connection
            this.robotConnections.set(robotId, ws);

            // Store last sensor data
            this.lastSensorData.set(robotId, message);

            // Log the received data
            try {
              db.addCommandLog(robotId, 'received', message);
            } catch (logErr) {
              console.error('[BrainServer] Failed to log command:', logErr.message);
            }

            // Emit sensor data to renderer
            this.emitEvent('sensor:data', { 
              robotId, 
              data: message, 
              format: message._format || 'json' 
            });

            // Get robot config for AI processing
            let robot = null;
            try {
              robot = db.getRobot(robotId);
            } catch (e) {
              // Robot might not be in DB - continue with defaults
            }

            // Process with AI
            let aiConfig = null;
            if (robot) {
              try {
                aiConfig = db.getActiveAiConfig(robot.id);
              } catch (e) {
                // No AI config - use rule-based
              }
            }

            const commands = await this.processWithAI(robot, message, aiConfig);

            // Build response (always JSON commands)
            const response = {
              command_id: `cmd_${++this.commandCounter}`,
              timestamp: Date.now(),
              output_commands: commands,
              metadata: {
                confidence: 0.85,
                reasoning: `Processed ${Object.keys(message.input_sensors_read || {}).length} sensors, issued ${Object.keys(commands).length} commands`,
                format: message._format || 'json'
              }
            };

            // Send response to robot
            ws.send(JSON.stringify(response));

            // Log the sent command
            try {
              db.addCommandLog(robotId, 'sent', response);
            } catch (logErr) {
              console.error('[BrainServer] Failed to log response:', logErr.message);
            }

            // Emit command event to renderer
            this.emitEvent('command:sent', { robotId, response });

          } catch (parseErr) {
            console.error('[BrainServer] Invalid message:', parseErr.message);
            ws.send(JSON.stringify({ error: 'Invalid message format' }));
          }
        });

        ws.on('close', () => {
          if (robotId) {
            this.robotConnections.delete(robotId);
            this.lastSensorData.delete(robotId);
            this.emitEvent('client:disconnected', { robotId });
          }
          console.log(`[BrainServer] Robot ${robotId || 'unknown'} disconnected`);
        });

        ws.on('error', (err) => {
          console.error(`[BrainServer] WebSocket error for ${robotId}:`, err.message);
        });
      });

      this.wss.on('error', (err) => {
        console.error('[BrainServer] Server error:', err.message);
        this.emitEvent('server:error', { error: err.message });
      });

      return { success: true, port, host };
    } catch (err) {
      console.error('[BrainServer] Failed to start:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop the brain server
   */
  stop() {
    if (!this.running) return { success: false, error: 'Server not running' };

    // Close all robot connections
    for (const [robotId, ws] of this.robotConnections) {
      ws.close(1001, 'Server shutting down');
    }
    this.robotConnections.clear();
    this.lastSensorData.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.running = false;
    this.emitEvent('server:stopped', {});
    console.log('[BrainServer] Stopped');
    return { success: true };
  }

  /**
   * Get current server status
   */
  getStatus() {
    return {
      running: this.running,
      host: this.host,
      port: this.port,
      connectedRobots: Array.from(this.robotConnections.keys()),
      emergencyStopped: Array.from(this.emergencyStopped),
      lastSensorData: Object.fromEntries(
        Array.from(this.lastSensorData.entries()).map(([id, data]) => [id, {
          timestamp: data.timestamp || Date.now(),
          sensors: Object.keys(data.input_sensors_read || {}),
          format: data._format || 'json'
        }])
      )
    };
  }

  /**
   * Emergency stop a specific robot (or all)
   */
  emergencyStop(robotId = null) {
    if (robotId) {
      this.emergencyStopped.add(robotId);
      // Send stop command to robot
      const ws = this.robotConnections.get(robotId);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          command_id: `cmd_emergency_${Date.now()}`,
          output_commands: { _emergency_stop: { action: 'halt', value: 1 } },
          metadata: { confidence: 1.0, reasoning: 'EMERGENCY STOP ACTIVATED' }
        }));
      }
      this.emitEvent('emergency:stop', { robotId });
      console.log(`[BrainServer] EMERGENCY STOP for robot ${robotId}`);
    } else {
      // Stop all robots
      for (const [id, ws] of this.robotConnections) {
        this.emergencyStopped.add(id);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            command_id: `cmd_emergency_${Date.now()}`,
            output_commands: { _emergency_stop: { action: 'halt', value: 1 } },
            metadata: { confidence: 1.0, reasoning: 'EMERGENCY STOP - ALL ROBOTS' }
          }));
        }
      }
      this.emitEvent('emergency:stop', { robotId: 'ALL' });
      console.log('[BrainServer] EMERGENCY STOP - ALL ROBOTS');
    }
    return { success: true };
  }

  /**
   * Release emergency stop for a robot
   */
  releaseEmergencyStop(robotId) {
    this.emergencyStopped.delete(robotId);
    this.emitEvent('emergency:released', { robotId });
    return { success: true };
  }

  // ==================================================================
  // AI PROCESSING
  // ==================================================================

  /**
   * Process sensor data with the configured AI model
   */
  async processWithAI(robot, sensorData, aiConfig) {
    const modelType = aiConfig?.model_type || robot?.ai_model || 'rule-based';

    // Get pin definitions for context
    let pins = [];
    if (robot) {
      try {
        pins = db.getPins(robot.id);
      } catch (e) {
        // No pins available
      }
    }

    const pinContext = pins.map(p =>
      `${p.pin_name} (pin ${p.pin_number}, ${p.mode}): ${p.description || 'No description'}`
    ).join('\n');

    switch (modelType) {
      case 'gpt4':
        return await this.processWithGPT4(robot, sensorData, aiConfig, pinContext);
      case 'claude':
        return await this.processWithClaude(robot, sensorData, aiConfig, pinContext);
      case 'llama3':
      case 'llama':
        return await this.processWithLLaMA(robot, sensorData, aiConfig, pinContext);
      case 'custom':
        return await this.processWithCustom(robot, sensorData, aiConfig, pinContext);
      case 'rule-based':
      default:
        return this.processWithRules(robot, sensorData, pins);
    }
  }

  /**
   * Rule-based processing engine (built-in, no API needed)
   * Works directly on structured sensor data parsed from the natural language prompt.
   */
  processWithRules(robot, sensorData, pins) {
    const commands = {};
    const sensors = sensorData.input_sensors_read || {};
    const available = sensorData.output_modules_available || [];

    // Temperature rule: if temp > 30, turn on LED warning
    const temp = sensors.temperature || sensors.temperature_sensor || 0;
    if (temp > 30 && (available.includes('ledpin') || pins.some(p => p.pin_name === 'ledpin'))) {
      commands.ledpin = { action: 'digitalwrite', value: 1 };
      this.emitEvent('rule:triggered', { rule: 'high_temperature', sensor: 'temperature', value: temp });
    } else if (temp < 25 && temp > 0 && (available.includes('ledpin') || pins.some(p => p.pin_name === 'ledpin'))) {
      commands.ledpin = { action: 'digitalwrite', value: 0 };
    }

    // Ultrasonic rule: if distance < 50cm, reach (move arm)
    const distance = sensors.ultrasonic || sensors.distance || 999;
    if (distance < 50 && (available.includes('urhands') || pins.some(p => p.pin_name === 'urhands'))) {
      commands.urhands = { action: 'servo', angle: 45 };
      this.emitEvent('rule:triggered', { rule: 'object_close', sensor: 'ultrasonic', value: distance });
    } else if (distance > 100 && (available.includes('urhands') || pins.some(p => p.pin_name === 'urhands'))) {
      commands.urhands = { action: 'servo', angle: 0 };
    }

    // Camera detection: if object detected, signal
    const cameraData = sensors.camera || sensors.object_detected;
    if (cameraData && (available.includes('ledpin') || pins.some(p => p.pin_name === 'ledpin'))) {
      if (cameraData !== 'none' && cameraData !== 0) {
        commands.ledpin = { action: 'digitalwrite', value: 1 };
      }
    }

    // Microphone: if voice command detected
    const micData = sensors.microphone || sensors.voice_command;
    if (micData && micData !== 'none' && micData !== '') {
      this.emitEvent('rule:triggered', { rule: 'voice_command', sensor: 'microphone', value: micData });
    }

    // Walking demo: cycle leg movement
    if (available.includes('llleg') || pins.some(p => p.pin_name === 'llleg')) {
      const angle = Math.floor(Math.random() * 60) + 30;
      commands.llleg = { action: 'servo', angle };
    }

    return commands;
  }

  /**
   * Process with OpenAI GPT-4
   * Sends the natural language prompt from the ESP32 to GPT-4.
   */
  async processWithGPT4(robot, sensorData, aiConfig, pinContext) {
    if (!aiConfig?.api_key) {
      console.warn('[BrainServer] No API key for GPT-4, falling back to rules');
      return this.processWithRules(robot, sensorData, []);
    }

    const prompt = this.buildPrompt(robot, sensorData, pinContext);

    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a robot control AI. You receive sensor data as a natural language prompt and respond with valid JSON mapping module names to command objects with action and value/angle fields.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 500
      }, {
        headers: { 'Authorization': `Bearer ${aiConfig.api_key}` },
        timeout: 10000
      });

      const content = response.data.choices[0].message.content;
      return JSON.parse(content);
    } catch (err) {
      console.error('[BrainServer] GPT-4 error:', err.message);
      return this.processWithRules(robot, sensorData, []);
    }
  }

  /**
   * Process with Anthropic Claude
   * Sends the natural language prompt from the ESP32 to Claude.
   */
  async processWithClaude(robot, sensorData, aiConfig, pinContext) {
    if (!aiConfig?.api_key) {
      console.warn('[BrainServer] No API key for Claude, falling back to rules');
      return this.processWithRules(robot, sensorData, []);
    }

    const prompt = this.buildPrompt(robot, sensorData, pinContext);

    try {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        system: 'You are a robot control AI. You receive sensor data as a natural language prompt and respond with valid JSON mapping module names to command objects with action and value/angle fields.',
        messages: [{ role: 'user', content: prompt }]
      }, {
        headers: {
          'x-api-key': aiConfig.api_key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const content = response.data.content[0].text;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return this.processWithRules(robot, sensorData, []);
    } catch (err) {
      console.error('[BrainServer] Claude error:', err.message);
      return this.processWithRules(robot, sensorData, []);
    }
  }

  /**
   * Process with local LLaMA (via Ollama)
   * Sends the natural language prompt from the ESP32 to local LLaMA.
   */
  async processWithLLaMA(robot, sensorData, aiConfig, pinContext) {
    const endpoint = aiConfig?.endpoint || 'http://localhost:11434';
    const prompt = this.buildPrompt(robot, sensorData, pinContext);

    try {
      const response = await axios.post(`${endpoint}/api/generate`, {
        model: 'llama3',
        prompt: `You are a robot control AI. You receive sensor data as a natural language prompt and respond ONLY with valid JSON mapping module names to command objects.\n\n${prompt}`,
        stream: false,
        options: { temperature: 0.1 }
      }, { timeout: 30000 });

      const content = response.data.response;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return this.processWithRules(robot, sensorData, []);
    } catch (err) {
      console.error('[BrainServer] LLaMA error:', err.message);
      return this.processWithRules(robot, sensorData, []);
    }
  }

  /**
   * Process with custom endpoint
   */
  async processWithCustom(robot, sensorData, aiConfig, pinContext) {
    const endpoint = aiConfig?.endpoint;
    if (!endpoint) {
      return this.processWithRules(robot, sensorData, []);
    }

    try {
      const response = await axios.post(endpoint, {
        robot: robot ? { name: robot.name, type: robot.type, purpose: robot.purpose } : null,
        sensor_data: sensorData,
        pin_context: pinContext,
        raw_prompt: sensorData._raw_prompt || null
      }, {
        headers: aiConfig.api_key ? { 'Authorization': `Bearer ${aiConfig.api_key}` } : {},
        timeout: 10000
      });
      return response.data.commands || response.data.output_commands || {};
    } catch (err) {
      console.error('[BrainServer] Custom endpoint error:', err.message);
      return this.processWithRules(robot, sensorData, []);
    }
  }

  /**
   * Build AI prompt from robot context.
   * 
   * If the ESP32 sent a natural language prompt, we pass it through directly
   * and add robot identity and hardware descriptions as context.
   * The AI reads: "Currently, the input sensors read: (...), What do you want to do to: (...)"
   * and responds with JSON commands.
   */
  buildPrompt(robot, sensorData, pinContext) {
    const rawPrompt = sensorData._raw_prompt || '';
    
    if (rawPrompt) {
      // The ESP32 sent a natural language prompt — use it directly
      let prompt = '';
      
      if (robot) {
        prompt += `You are controlling a ${robot.type || 'unknown'} robot named ${robot.name || 'unknown'}.\n`;
        if (robot.purpose) prompt += `Purpose: ${robot.purpose}\n`;
        if (robot.environment) prompt += `Environment: ${robot.environment}\n`;
        prompt += '\n';
      }
      
      if (pinContext) {
        prompt += `Available hardware:\n${pinContext}\n\n`;
      }
      
      // The actual sensor data prompt from the ESP32
      prompt += rawPrompt;
      
      prompt += '\n\nRespond with ONLY a JSON object mapping module names to commands.\n';
      prompt += 'Example: {"ledpin": {"action": "digitalwrite", "value": 1}, "urhands": {"action": "servo", "angle": 45}}';
      
      return prompt;
    }
    
    // Fallback: build structured prompt from sensor data
    let prompt = '';
    
    if (robot) {
      prompt += `You are controlling a ${robot.type || 'unknown'} robot named ${robot.name || 'unknown'}.\n`;
      if (robot.purpose) prompt += `Purpose: ${robot.purpose}\n`;
      if (robot.environment) prompt += `Environment: ${robot.environment}\n`;
      prompt += '\n';
    }
    
    if (pinContext) {
      prompt += `Available hardware:\n${pinContext}\n\n`;
    }
    
    // Build the natural language format from structured data
    const sensors = sensorData.input_sensors_read || {};
    const available = sensorData.output_modules_available || [];
    
    prompt += 'Currently, the input sensors read:\n';
    if (Object.keys(sensors).length > 0) {
      const sensorStr = Object.entries(sensors)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(', ');
      prompt += `(${sensorStr}),\n`;
    } else {
      prompt += '(No sensor data),\n';
    }
    
    prompt += 'What do you want to do to:\n';
    if (available.length > 0) {
      prompt += `(${available.join(', ')}).`;
    } else {
      prompt += '(No output modules available).';
    }
    
    prompt += '\n\nRespond with ONLY a JSON object mapping module names to commands.\n';
    prompt += 'Example: {"ledpin": {"action": "digitalwrite", "value": 1}, "urhands": {"action": "servo", "angle": 45}}';
    
    return prompt;
  }
}

// Singleton instance
const brainServer = new BrainServer();

module.exports = brainServer;
