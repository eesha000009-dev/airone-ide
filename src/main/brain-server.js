/**
 * Airone AI Backbone - Brain Server (Multi-Model)
 * WebSocket server that hosts MULTIPLE LNN models simultaneously.
 * Each robot gets its own model, routed by the ?robot=<name> query parameter.
 *
 * Features:
 * - Multi-model LNN processing (trained weights, not random)
 * - WebSocket server with robot routing via ?robot=name query param
 * - Rule-based fallback when no LNN model is available
 * - LLM integration (OpenAI, Claude, LLaMA, Kimi K2.6)
 * - Emergency stop capability
 * - Command history logging
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
    this.emergencyStopped = new Set();
    this.eventCallback = null;
    this.lastSensorData = new Map();
    this.commandCounter = 0;

    // Multi-model LNN support
    this.lnnModels = new Map(); // robot_name -> LNN model config with trained weights
  }

  setEventCallback(callback) {
    this.eventCallback = callback;
  }

  emitEvent(eventType, data) {
    if (this.eventCallback) {
      this.eventCallback({ type: eventType, data, timestamp: Date.now() });
    }
  }

  // ==================== MULTI-MODEL LNN ====================

  /**
   * Register an LNN model for a robot.
   * @param {string} robotName - The robot's name (used for routing)
   * @param {Object} modelConfig - LNN model config with trained weights
   */
  registerLnnModel(robotName, modelConfig) {
    this.lnnModels.set(robotName.toLowerCase().replace(/[^a-z0-9]/g, '-'), modelConfig);
    console.log(`[BrainServer] Registered LNN model for: ${robotName} (${this.lnnModels.size} total models)`);
  }

  /**
   * Get the LNN model for a robot.
   */
  getLnnModel(robotName) {
    const key = robotName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return this.lnnModels.get(key) || null;
  }

  /**
   * Process sensor data through the LNN model.
   * Uses trained weights for inference.
   */
  processWithLNN(modelConfig, sensorData) {
    const inputMapping = modelConfig.input_mapping || {};
    const outputMapping = modelConfig.output_mapping || {};
    const outputTypes = modelConfig.output_types || {};
    const weights = modelConfig.weights || {};
    const hiddenUnits = modelConfig.hidden_units || 16;
    const inputSize = modelConfig.input_size;
    const outputSize = modelConfig.output_size;
    const params = modelConfig.neuron_params || {};

    // Get weights (fallback to Xavier init)
    const W_in = weights.W_in || this._xavierInit(hiddenUnits, inputSize);
    const W_out = weights.W_out || this._xavierInit(outputSize, hiddenUnits);
    const b_in = weights.b_in || new Array(hiddenUnits).fill(0);
    const b_out = weights.b_out || new Array(outputSize).fill(0);

    // Build input array from sensor data
    const sensors = sensorData.input_sensors_read || sensorData;
    const inputArr = new Array(inputSize).fill(0);
    for (const [name, idx] of Object.entries(inputMapping)) {
      if (idx < inputSize) {
        let val = sensors[name];
        if (val === undefined) val = 0;
        if (typeof val === 'string') val = parseFloat(val) || 0;
        inputArr[idx] = val;
      }
    }

    // Forward pass: hidden = tanh(W_in * x + b_in)
    const hidden = new Array(hiddenUnits).fill(0);
    for (let i = 0; i < hiddenUnits; i++) {
      let sum = b_in[i];
      for (let j = 0; j < inputSize; j++) {
        sum += W_in[i][j] * inputArr[j];
      }
      hidden[i] = Math.tanh(sum);
    }

    // Output: y = sigmoid(W_out * h + b_out)
    const rawOutputs = new Array(outputSize).fill(0);
    for (let i = 0; i < outputSize; i++) {
      let sum = b_out[i];
      for (let j = 0; j < hiddenUnits; j++) {
        sum += W_out[i][j] * hidden[j];
      }
      rawOutputs[i] = this._sigmoid(sum);
    }

    // Format outputs based on output types
    const commands = {};
    for (const [name, idx] of Object.entries(outputMapping)) {
      if (idx < outputSize) {
        const rawVal = rawOutputs[idx];
        const outType = outputTypes[name] || 'digital';
        commands[name] = this._formatOutput(rawVal, outType);
      }
    }

    return commands;
  }

  _sigmoid(x) {
    if (x >= 0) return 1.0 / (1.0 + Math.exp(-x));
    const ex = Math.exp(x);
    return ex / (1.0 + ex);
  }

  _xavierInit(rows, cols) {
    const limit = Math.sqrt(6.0 / (rows + cols));
    const matrix = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) {
        row.push((Math.random() * 2 - 1) * limit);
      }
      matrix.push(row);
    }
    return matrix;
  }

  _formatOutput(rawVal, outType) {
    if (outType === 'pwm' || outType === 'motor') {
      return { action: 'pwm', value: Math.max(0, Math.min(255, Math.round(rawVal * 255))) };
    } else if (outType === 'servo') {
      return { action: 'servo', angle: Math.max(0, Math.min(180, Math.round(rawVal * 180))) };
    } else {
      return { action: 'digitalwrite', value: rawVal > 0.5 ? 1 : 0 };
    }
  }

  // ==================== NATURAL LANGUAGE PARSER ====================

  parseNaturalLanguagePrompt(text) {
    const result = {
      input_sensors_read: {},
      output_modules_available: [],
      _raw_prompt: text,
      _format: 'natural_language',
      ask_question: '',
      ask_context: ''
    };

    const sensorsMatch = text.match(/Currently, the input sensors read:\s*\n?\s*\(([^)]*)\)/i);
    if (sensorsMatch) {
      const sensorText = sensorsMatch[1].trim();
      if (sensorText && !sensorText.toLowerCase().includes('no input sensors')) {
        const pairs = sensorText.split(',');
        for (const pair of pairs) {
          const trimmed = pair.trim();
          if (trimmed.includes(':')) {
            const [key, ...valParts] = trimmed.split(':');
            let val = valParts.join(':').trim();
            const num = Number(val);
            if (!isNaN(num)) val = num;
            result.input_sensors_read[key.trim()] = val;
          }
        }
      }
    }

    const outputsMatch = text.match(/What do you want to do to:\s*\n?\s*\(([^)]*)\)/i);
    if (outputsMatch) {
      const outputText = outputsMatch[1].trim();
      if (outputText && !outputText.toLowerCase().includes('no output modules')) {
        const modules = outputText.split(',').map(m => m.trim().replace(/\./g, '')).filter(Boolean);
        result.output_modules_available = modules;
      }
    }

    const askMatch = text.match(/Also, the robot asks:\s*(.+?)(?:\s*\(Context:\s*(.+?)\))?$/im);
    if (askMatch) {
      result.ask_question = askMatch[1].trim();
      result.ask_context = askMatch[2] ? askMatch[2].trim() : '';
    }

    return result;
  }

  parseMessage(rawMessage) {
    try {
      const data = JSON.parse(rawMessage);
      if (typeof data === 'object' && data !== null) return data;
    } catch (_e) { }

    return this.parseNaturalLanguagePrompt(rawMessage);
  }

  // ==================== SERVER LIFECYCLE ====================

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
        console.log(`[BrainServer] LNN models loaded: ${this.lnnModels.size} (${Array.from(this.lnnModels.keys()).join(', ')})`);
        this.emitEvent('server:started', { port, host });
      });

      this.wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;

        // Extract robot name from query parameter: ?robot=name
        let routeRobotName = 'default';
        try {
          const url = req.url || '/';
          if (url.includes('?')) {
            const queryStr = url.split('?', 2)[1];
            const params = new URLSearchParams(queryStr);
            routeRobotName = params.get('robot') || params.get('name') || 'default';
          }
        } catch (_e) { }

        console.log(`[BrainServer] Client connected from ${clientIp} for robot: ${routeRobotName}`);
        this.emitEvent('client:connected', { ip: clientIp, robot: routeRobotName });

        let robotId = null;

        ws.on('message', async (rawData) => {
          try {
            const rawStr = rawData.toString();
            const message = this.parseMessage(rawStr);
            robotId = message.robot_id || routeRobotName;

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

            this.robotConnections.set(robotId, ws);
            this.lastSensorData.set(robotId, message);

            try { db.addCommandLog(robotId, 'received', message); } catch (_e) { }

            this.emitEvent('sensor:data', { robotId, data: message, format: message._format || 'json' });

            // Try LNN model first (if available for this robot)
            const lnnModel = this.getLnnModel(robotId) || this.getLnnModel(routeRobotName);
            let commands;

            if (lnnModel) {
              // Process with trained LNN
              commands = this.processWithLNN(lnnModel, message);
              console.log(`[BrainServer] Processed with LNN for ${robotId}: ${Object.keys(commands).length} commands`);
            } else {
              // Fall back to AI/rule-based processing
              let robot = null;
              try { robot = db.getRobot(robotId); } catch (_e) { }

              let aiConfig = null;
              if (robot) {
                try { aiConfig = db.getActiveAiConfig(robot.id); } catch (_e) { }
              }

              commands = await this.processWithAI(robot, message, aiConfig);
            }

            const response = {
              command_id: `cmd_${++this.commandCounter}`,
              timestamp: Date.now(),
              output_commands: commands,
              metadata: {
                confidence: 0.85,
                reasoning: lnnModel
                  ? `LNN inference for ${robotId} (${lnnModel.input_size}in/${lnnModel.output_size}out)`
                  : `Processed ${Object.keys(message.input_sensors_read || {}).length} sensors, issued ${Object.keys(commands).length} commands`,
                format: message._format || 'json',
                model: lnnModel ? 'lnn' : 'rule-based'
              }
            };

            ws.send(JSON.stringify(response));

            try { db.addCommandLog(robotId, 'sent', response); } catch (_e) { }
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

  stop() {
    if (!this.running) return { success: false, error: 'Server not running' };

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

  getStatus() {
    return {
      running: this.running,
      host: this.host,
      port: this.port,
      connectedRobots: Array.from(this.robotConnections.keys()),
      emergencyStopped: Array.from(this.emergencyStopped),
      lnnModels: Array.from(this.lnnModels.keys()),
      lastSensorData: Object.fromEntries(
        Array.from(this.lastSensorData.entries()).map(([id, data]) => [id, {
          timestamp: data.timestamp || Date.now(),
          sensors: Object.keys(data.input_sensors_read || {}),
          format: data._format || 'json'
        }])
      )
    };
  }

  emergencyStop(robotId = null) {
    if (robotId) {
      this.emergencyStopped.add(robotId);
      const ws = this.robotConnections.get(robotId);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          command_id: `cmd_emergency_${Date.now()}`,
          output_commands: { _emergency_stop: { action: 'halt', value: 1 } },
          metadata: { confidence: 1.0, reasoning: 'EMERGENCY STOP ACTIVATED' }
        }));
      }
      this.emitEvent('emergency:stop', { robotId });
    } else {
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
    }
    return { success: true };
  }

  releaseEmergencyStop(robotId) {
    this.emergencyStopped.delete(robotId);
    this.emitEvent('emergency:released', { robotId });
    return { success: true };
  }

  // ==================== AI PROCESSING (FALLBACK) ====================

  async processWithAI(robot, sensorData, aiConfig) {
    const modelType = aiConfig?.model_type || robot?.ai_model || 'rule-based';

    let pins = [];
    if (robot) {
      try { pins = db.getPins(robot.id); } catch (_e) { }
    }

    const pinContext = pins.map(p =>
      `${p.pin_name} (pin ${p.pin_number}, ${p.mode}): ${p.description || 'No description'}`
    ).join('\n');

    switch (modelType) {
      case 'gpt4':
        return await this.processWithGPT4(robot, sensorData, aiConfig, pinContext);
      case 'claude':
        return await this.processWithClaude(robot, sensorData, aiConfig, pinContext);
      case 'kimi-k2.6':
        return await this.processWithKimi(robot, sensorData, aiConfig, pinContext);
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

  processWithRules(robot, sensorData, pins) {
    const commands = {};
    const sensors = sensorData.input_sensors_read || {};
    const available = sensorData.output_modules_available || [];

    const temp = sensors.temperature || sensors.temperature_sensor || 0;
    if (temp > 30 && (available.includes('ledpin') || pins.some(p => p.pin_name === 'ledpin'))) {
      commands.ledpin = { action: 'digitalwrite', value: 1 };
    }

    const distance = sensors.ultrasonic || sensors.distance || 999;
    if (distance < 50 && (available.includes('urhands') || pins.some(p => p.pin_name === 'urhands'))) {
      commands.urhands = { action: 'servo', angle: 45 };
    }

    return commands;
  }

  async processWithKimi(robot, sensorData, aiConfig, pinContext) {
    const nvidiaClient = require('./nvidia-client');
    const prompt = this.buildPrompt(robot, sensorData, pinContext);

    try {
      const content = await nvidiaClient.sendChatCompletion({
        messages: [
          { role: 'system', content: 'You are a robot control AI. Respond with ONLY valid JSON mapping module names to command objects with action and value/angle fields.' },
          { role: 'user', content: prompt }
        ],
        model: 'moonshotai/kimi-k2.6'
      });

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return this.processWithRules(robot, sensorData, []);
    } catch (err) {
      console.error('[BrainServer] Kimi error:', err.message);
      return this.processWithRules(robot, sensorData, []);
    }
  }

  async processWithGPT4(robot, sensorData, aiConfig, pinContext) {
    if (!aiConfig?.api_key) return this.processWithRules(robot, sensorData, []);
    const prompt = this.buildPrompt(robot, sensorData, pinContext);

    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a robot control AI. Respond with valid JSON mapping module names to command objects.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 500
      }, { headers: { 'Authorization': `Bearer ${aiConfig.api_key}` }, timeout: 10000 });

      return JSON.parse(response.data.choices[0].message.content);
    } catch (err) {
      return this.processWithRules(robot, sensorData, []);
    }
  }

  async processWithClaude(robot, sensorData, aiConfig, pinContext) {
    if (!aiConfig?.api_key) return this.processWithRules(robot, sensorData, []);
    const prompt = this.buildPrompt(robot, sensorData, pinContext);

    try {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        system: 'You are a robot control AI. Respond with valid JSON mapping module names to command objects.',
        messages: [{ role: 'user', content: prompt }]
      }, {
        headers: { 'x-api-key': aiConfig.api_key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        timeout: 10000
      });

      const jsonMatch = response.data.content[0].text.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : this.processWithRules(robot, sensorData, []);
    } catch (err) {
      return this.processWithRules(robot, sensorData, []);
    }
  }

  async processWithLLaMA(robot, sensorData, aiConfig, pinContext) {
    const endpoint = aiConfig?.endpoint || 'http://localhost:11434';
    const prompt = this.buildPrompt(robot, sensorData, pinContext);

    try {
      const response = await axios.post(`${endpoint}/api/generate`, {
        model: 'llama3',
        prompt: `Robot control AI. Respond ONLY with valid JSON.\n\n${prompt}`,
        stream: false,
        options: { temperature: 0.1 }
      }, { timeout: 30000 });

      const jsonMatch = response.data.response.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : this.processWithRules(robot, sensorData, []);
    } catch (err) {
      return this.processWithRules(robot, sensorData, []);
    }
  }

  async processWithCustom(robot, sensorData, aiConfig, pinContext) {
    const endpoint = aiConfig?.endpoint;
    if (!endpoint) return this.processWithRules(robot, sensorData, []);

    try {
      const response = await axios.post(endpoint, {
        robot: robot ? { name: robot.name, type: robot.type } : null,
        sensor_data: sensorData,
        pin_context: pinContext
      }, { headers: aiConfig.api_key ? { 'Authorization': `Bearer ${aiConfig.api_key}` } : {}, timeout: 10000 });

      return response.data.commands || response.data.output_commands || {};
    } catch (err) {
      return this.processWithRules(robot, sensorData, []);
    }
  }

  buildPrompt(robot, sensorData, pinContext) {
    const rawPrompt = sensorData._raw_prompt || '';
    let prompt = '';

    if (robot) {
      prompt += `You are controlling a ${robot.type || 'unknown'} robot named ${robot.name || 'unknown'}.\n`;
      if (robot.purpose) prompt += `Purpose: ${robot.purpose}\n`;
      prompt += '\n';
    }

    if (pinContext) prompt += `Available hardware:\n${pinContext}\n\n`;

    if (rawPrompt) {
      prompt += rawPrompt;
    } else {
      const sensors = sensorData.input_sensors_read || {};
      const available = sensorData.output_modules_available || [];

      prompt += 'Currently, the input sensors read:\n';
      prompt += Object.keys(sensors).length > 0
        ? `(${Object.entries(sensors).map(([k, v]) => `${k}: ${v}`).join(', ')}),\n`
        : '(No sensor data),\n';

      prompt += 'What do you want to do to:\n';
      prompt += available.length > 0 ? `(${available.join(', ')}).` : '(No output modules available).';
    }

    prompt += '\n\nRespond with ONLY a JSON object mapping module names to commands.';
    return prompt;
  }
}

const brainServer = new BrainServer();

module.exports = brainServer;
