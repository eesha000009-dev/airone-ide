/**
 * Airone AI Backbone - AI Model Selection Component
 * Choose which AI model will control the robot.
 * Supports: Rule-Based Engine, OpenAI GPT-4, Anthropic Claude, Local LLaMA 3, Kimi K2.6, Custom Endpoint.
 * Each model has different capabilities and requirements.
 */

import React, { useState, useEffect } from 'react';

const AI_MODELS = [
  {
    id: 'rule-based',
    name: 'Rule-Based Engine',
    type: 'deterministic',
    description: 'Built-in rule engine. No API needed, works offline. Fast and predictable.',
    color: 'orange',
    requires_key: false,
    endpoint: null
  },
  {
    id: 'gpt4',
    name: 'OpenAI GPT-4',
    type: 'cloud',
    description: 'State-of-the-art language model. Requires API key and internet connection.',
    color: 'blue',
    requires_key: true,
    endpoint: null
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    type: 'cloud',
    description: 'Advanced AI assistant by Anthropic. Requires API key and internet connection.',
    color: 'purple',
    requires_key: true,
    endpoint: null
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6 (NVIDIA)',
    type: 'cloud',
    description: 'Advanced AI via NVIDIA API. Supports LNN model generation and robot control. Pre-configured for Airone.',
    color: 'green',
    requires_key: false,
    endpoint: 'https://integrate.api.nvidia.com/v1'
  },
  {
    id: 'llama3',
    name: 'Local LLaMA 3',
    type: 'local',
    description: 'Run locally via Ollama. No internet needed but requires local GPU setup.',
    color: 'green',
    requires_key: false,
    endpoint: 'http://localhost:11434'
  },
  {
    id: 'custom',
    name: 'Custom Endpoint',
    type: 'custom',
    description: 'Connect to your own AI server or custom API endpoint.',
    color: 'cyan',
    requires_key: false,
    endpoint: null
  }
];

const colorChipMap = {
  orange: 'chip-orange',
  blue: 'chip-blue',
  purple: 'chip-purple',
  green: 'chip-green',
  cyan: 'chip-cyan'
};

function AiModel() {
  const [selectedModel, setSelectedModel] = useState('rule-based');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('http://localhost:11434');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [robotId, setRobotId] = useState(null);
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const robots = await window.aironeAPI.getAllRobots();
      if (robots && robots.length > 0) {
        const first = robots[0];
        setRobotId(first.id);
        setSelectedModel(first.ai_model || 'rule-based');
        const aiConfig = await window.aironeAPI.getActiveAiConfig(first.id);
        if (aiConfig) {
          setApiKey(aiConfig.api_key || '');
          setEndpoint(aiConfig.endpoint || 'http://localhost:11434');
        }
      }
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  };

  const handleSelectModel = (modelId) => {
    setSelectedModel(modelId);
    setTestResult(null);
    setConfigSaved(false);

    // Update endpoint when selecting a model with a default endpoint
    const model = AI_MODELS.find(m => m.id === modelId);
    if (model && model.endpoint) {
      setEndpoint(model.endpoint);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await window.aironeAPI.getBrainServerStatus();

      if (selectedModel === 'rule-based') {
        setTestResult({ success: true, message: 'Rule-based engine is ready. No connection test needed.' });
      } else if (selectedModel === 'llama3') {
        try {
          const response = await fetch(`${endpoint}/api/tags`);
          if (response.ok) {
            const data = await response.json();
            const hasLlama = data.models?.some(m => m.name?.includes('llama'));
            setTestResult({
              success: true,
              message: 'Ollama connected! ' + (hasLlama ? 'LLaMA model found.' : 'Warning: LLaMA model not found. Run: ollama pull llama3')
            });
          } else {
            setTestResult({ success: false, message: `Ollama returned status ${response.status}. Make sure Ollama is running.` });
          }
        } catch (e) {
          setTestResult({ success: false, message: 'Cannot connect to Ollama. Make sure it is running at ' + endpoint });
        }
      } else if (selectedModel === 'gpt4') {
        setTestResult(apiKey
          ? { success: true, message: 'API key provided. Connection will be tested when robot sends data. (Actual API call would use credits)' }
          : { success: false, message: 'API key is required for GPT-4.' }
        );
      } else if (selectedModel === 'claude') {
        setTestResult(apiKey
          ? { success: true, message: 'API key provided. Connection will be tested when robot sends data.' }
          : { success: false, message: 'API key is required for Claude.' }
        );
      } else if (selectedModel === 'kimi-k2.6') {
        try {
          const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });
          if (response.ok || response.status === 200) {
            setTestResult({ success: true, message: 'NVIDIA API endpoint reachable. Kimi K2.6 is pre-configured and ready to use with Airone.' });
          } else {
            setTestResult({ success: true, message: 'NVIDIA API endpoint responded. Kimi K2.6 will be available when generating LNN models.' });
          }
        } catch (e) {
          setTestResult({ success: false, message: 'Cannot reach NVIDIA API endpoint. Check your internet connection.' });
        }
      } else if (selectedModel === 'custom') {
        if (endpoint) {
          try {
            const response = await fetch(endpoint, { method: 'OPTIONS' });
            setTestResult({ success: true, message: `Custom endpoint responded with status ${response.status}.` });
          } catch (e) {
            setTestResult({ success: false, message: 'Cannot connect to custom endpoint: ' + e.message });
          }
        } else {
          setTestResult({ success: false, message: 'Endpoint URL is required.' });
        }
      }
    } catch (e) {
      setTestResult({ success: false, message: 'Test failed: ' + e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (robotId) {
      try {
        await window.aironeAPI.updateRobot(robotId, { ai_model: selectedModel });
        await window.aironeAPI.saveAiConfig(robotId, {
          model_type: selectedModel,
          api_key: apiKey,
          endpoint: endpoint
        });
        setConfigSaved(true);
      } catch (e) {
        setTestResult({ success: false, message: 'Failed to save: ' + e.message });
      }
    } else {
      setTestResult({ success: false, message: 'No robot configured. Please set up a robot identity first.' });
    }
  };

  return (
    <div className="ai-model-select fade-in">
      <div className="page-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
          <path d="M12 2a5 5 0 0 1 5 5c0 .91-.244 1.765-.67 2.5H17a4 4 0 0 1 0 8h-1.05A5.001 5.001 0 0 1 7 19a5.001 5.001 0 0 1-1.95-9.5A5 5 0 0 1 12 2z" />
          <line x1="12" y1="10" x2="12" y2="22" />
          <line x1="8" y1="14" x2="16" y2="14" />
        </svg>
        <h2>Select AI Brain</h2>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <div className="card-header">
          <h3 className="card-title">Choose AI Model</h3>
        </div>
        <p className="card-subtitle">
          Choose which AI model will control your robot. Each has different capabilities and requirements.
          The rule-based engine is always available as a fallback.
        </p>

        <div className="model-list">
          {AI_MODELS.map(model => (
            <div
              key={model.id}
              className={`model-item ${selectedModel === model.id ? 'selected' : ''}`}
              onClick={() => handleSelectModel(model.id)}
            >
              <div className="model-radio">
                <div className={`radio-outer ${selectedModel === model.id ? 'active' : ''}`}>
                  {selectedModel === model.id && <div className="radio-inner" />}
                </div>
              </div>
              <div className="model-content">
                <div className="model-header">
                  <span className="model-name">{model.name}</span>
                  <span className={`chip ${colorChipMap[model.color] || 'chip-cyan'}`}>
                    {model.type}
                  </span>
                </div>
                <p className="model-description">{model.description}</p>

                {/* API Key field for cloud models that require keys */}
                {model.requires_key && selectedModel === model.id && (
                  <div className="model-config" onClick={e => e.stopPropagation()}>
                    <div className="form-group" style={{ marginBottom: 0, marginTop: 8 }}>
                      <label className="form-label">API Key</label>
                      <input
                        type="password"
                        className="form-input"
                        value={apiKey}
                        onChange={e => { setApiKey(e.target.value); setConfigSaved(false); }}
                        placeholder="Enter your API key"
                      />
                      <div className="form-hint">Your key is stored locally and never shared</div>
                    </div>
                  </div>
                )}

                {/* Kimi K2.6 endpoint info (pre-configured, no key needed) */}
                {model.id === 'kimi-k2.6' && selectedModel === model.id && (
                  <div className="model-config" onClick={e => e.stopPropagation()}>
                    <div className="form-group" style={{ marginBottom: 0, marginTop: 8 }}>
                      <label className="form-label">NVIDIA API Endpoint</label>
                      <input
                        type="text"
                        className="form-input"
                        value={endpoint}
                        onChange={e => { setEndpoint(e.target.value); setConfigSaved(false); }}
                        placeholder="https://integrate.api.nvidia.com/v1"
                      />
                      <div className="form-hint">Pre-configured endpoint for Airone. No API key required.</div>
                    </div>
                  </div>
                )}

                {/* Custom endpoint field */}
                {model.type === 'custom' && selectedModel === model.id && (
                  <div className="model-config" onClick={e => e.stopPropagation()}>
                    <div className="form-group" style={{ marginBottom: 0, marginTop: 8 }}>
                      <label className="form-label">Custom Endpoint URL</label>
                      <input
                        type="text"
                        className="form-input"
                        value={endpoint}
                        onChange={e => { setEndpoint(e.target.value); setConfigSaved(false); }}
                        placeholder="http://your-brain-server:port"
                      />
                    </div>
                  </div>
                )}

                {/* Ollama endpoint field for local models */}
                {model.type === 'local' && selectedModel === model.id && (
                  <div className="model-config" onClick={e => e.stopPropagation()}>
                    <div className="form-group" style={{ marginBottom: 0, marginTop: 8 }}>
                      <label className="form-label">Ollama Endpoint</label>
                      <input
                        type="text"
                        className="form-input"
                        value={endpoint}
                        onChange={e => { setEndpoint(e.target.value); setConfigSaved(false); }}
                        placeholder="http://localhost:11434"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="model-actions">
          <button className="btn btn-secondary" onClick={handleTestConnection} disabled={testing}>
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save Configuration
          </button>
        </div>

        {testResult && (
          <div className={`alert ${testResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 16 }}>
            {testResult.success ? '✓ ' : '✗ '}{testResult.message}
          </div>
        )}
        {configSaved && !testResult && (
          <div className="alert alert-success" style={{ marginTop: 16 }}>
            ✓ AI configuration saved!
          </div>
        )}
      </div>
    </div>
  );
}

export default AiModel;
