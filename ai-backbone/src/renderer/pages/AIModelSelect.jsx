import React, { useState, useEffect } from 'react';
import './AIModelSelect.css';

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

function AIModelSelect() {
  const [selected, setSelected] = useState('rule-based');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('http://localhost:11434');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [robotId, setRobotId] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const robots = await window.aironeAPI.getAllRobots();
      if (robots && robots.length > 0) {
        const robot = robots[0];
        setRobotId(robot.id);
        setSelected(robot.ai_model || 'rule-based');

        const config = await window.aironeAPI.getActiveAiConfig(robot.id);
        if (config) {
          setApiKey(config.api_key || '');
          setEndpoint(config.endpoint || 'http://localhost:11434');
        }
      }
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  };

  const handleSelect = (modelId) => {
    setSelected(modelId);
    setTestResult(null);
    setSaved(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const status = await window.aironeAPI.getBrainServerStatus();
      
      if (selected === 'rule-based') {
        setTestResult({ success: true, message: 'Rule-based engine is ready. No connection test needed.' });
      } else if (selected === 'llama3') {
        try {
          // Test LLaMA via local endpoint
          const response = await fetch(`${endpoint}/api/tags`);
          if (response.ok) {
            const data = await response.json();
            const hasModel = data.models?.some(m => m.name?.includes('llama'));
            setTestResult({ 
              success: true, 
              message: `Ollama connected! ${hasModel ? 'LLaMA model found.' : 'Warning: LLaMA model not found. Run: ollama pull llama3'}` 
            });
          } else {
            setTestResult({ success: false, message: `Ollama returned status ${response.status}. Make sure Ollama is running.` });
          }
        } catch (e) {
          setTestResult({ success: false, message: 'Cannot connect to Ollama. Make sure it is running at ' + endpoint });
        }
      } else if (selected === 'gpt4') {
        if (!apiKey) {
          setTestResult({ success: false, message: 'API key is required for GPT-4.' });
        } else {
          setTestResult({ success: true, message: 'API key provided. Connection will be tested when robot sends data. (Actual API call would use credits)' });
        }
      } else if (selected === 'claude') {
        if (!apiKey) {
          setTestResult({ success: false, message: 'API key is required for Claude.' });
        } else {
          setTestResult({ success: true, message: 'API key provided. Connection will be tested when robot sends data.' });
        }
      } else if (selected === 'custom') {
        if (!endpoint) {
          setTestResult({ success: false, message: 'Endpoint URL is required.' });
        } else {
          try {
            const response = await fetch(endpoint, { method: 'OPTIONS' });
            setTestResult({ success: true, message: `Custom endpoint responded with status ${response.status}.` });
          } catch (e) {
            setTestResult({ success: false, message: 'Cannot connect to custom endpoint: ' + e.message });
          }
        }
      }
    } catch (e) {
      setTestResult({ success: false, message: 'Test failed: ' + e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!robotId) {
      setTestResult({ success: false, message: 'No robot configured. Please set up a robot identity first.' });
      return;
    }

    try {
      await window.aironeAPI.updateRobot(robotId, { ai_model: selected });
      await window.aironeAPI.saveAiConfig(robotId, {
        model_type: selected,
        api_key: apiKey,
        endpoint: endpoint
      });
      setSaved(true);
    } catch (e) {
      setTestResult({ success: false, message: 'Failed to save: ' + e.message });
    }
  };

  const getColorClass = (color) => {
    const map = {
      orange: 'chip-orange',
      blue: 'chip-blue',
      purple: 'chip-purple',
      green: 'chip-green',
      cyan: 'chip-cyan'
    };
    return map[color] || 'chip-cyan';
  };

  return (
    <div className="ai-model-select fade-in">
      <div className="page-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
          <path d="M12 2a5 5 0 0 1 5 5c0 .91-.244 1.765-.67 2.5H17a4 4 0 0 1 0 8h-1.05A5.001 5.001 0 0 1 7 19a5.001 5.001 0 0 1-1.95-9.5A5 5 0 0 1 12 2z"/>
          <line x1="12" y1="10" x2="12" y2="22"/><line x1="8" y1="14" x2="16" y2="14"/>
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
          {AI_MODELS.map((model) => (
            <div
              key={model.id}
              className={`model-item ${selected === model.id ? 'selected' : ''}`}
              onClick={() => handleSelect(model.id)}
            >
              <div className="model-radio">
                <div className={`radio-outer ${selected === model.id ? 'active' : ''}`}>
                  {selected === model.id && <div className="radio-inner" />}
                </div>
              </div>

              <div className="model-content">
                <div className="model-header">
                  <span className="model-name">{model.name}</span>
                  <span className={`chip ${getColorClass(model.color)}`}>{model.type}</span>
                </div>
                <p className="model-description">{model.description}</p>

                {model.requires_key && selected === model.id && (
                  <div className="model-config" onClick={(e) => e.stopPropagation()}>
                    <div className="form-group" style={{ marginBottom: 0, marginTop: 8 }}>
                      <label className="form-label">API Key</label>
                      <input
                        type="password"
                        className="form-input"
                        value={apiKey}
                        onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
                        placeholder="Enter your API key"
                      />
                      <div className="form-hint">Your key is stored locally and never shared</div>
                    </div>
                  </div>
                )}

                {model.type === 'custom' && selected === model.id && (
                  <div className="model-config" onClick={(e) => e.stopPropagation()}>
                    <div className="form-group" style={{ marginBottom: 0, marginTop: 8 }}>
                      <label className="form-label">Custom Endpoint URL</label>
                      <input
                        type="text"
                        className="form-input"
                        value={endpoint}
                        onChange={(e) => { setEndpoint(e.target.value); setSaved(false); }}
                        placeholder="http://your-brain-server:port"
                      />
                    </div>
                  </div>
                )}

                {model.type === 'local' && selected === model.id && (
                  <div className="model-config" onClick={(e) => e.stopPropagation()}>
                    <div className="form-group" style={{ marginBottom: 0, marginTop: 8 }}>
                      <label className="form-label">Ollama Endpoint</label>
                      <input
                        type="text"
                        className="form-input"
                        value={endpoint}
                        onChange={(e) => { setEndpoint(e.target.value); setSaved(false); }}
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
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
            Save Configuration
          </button>
        </div>

        {testResult && (
          <div className={`alert ${testResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 16 }}>
            {testResult.success ? '✓ ' : '✗ '}{testResult.message}
          </div>
        )}

        {saved && !testResult && (
          <div className="alert alert-success" style={{ marginTop: 16 }}>
            ✓ AI configuration saved!
          </div>
        )}
      </div>
    </div>
  );
}

export default AIModelSelect;
