/**
 * Airone AI Backbone - AI Chat Component
 * Interactive AI chat with LNN generation, training, verification, and cloud deployment.
 * Shows step-by-step progress for the full pipeline:
 * 1. Generating LNN Architecture
 * 2. Creating Training Data
 * 3. Training LNN
 * 4. Checking for Errors
 * 5. Testing LNN Behavior
 * 6. Finalizing Model
 * Then: Deploy to cloud brain service (multi-model)
 */

import React, { useState, useEffect, useRef } from 'react';

const GENERATION_STEPS = [
  { id: 'generating', name: 'Generating LNN Architecture', icon: '🏗️' },
  { id: 'creating_data', name: 'Creating Training Data', icon: '📊' },
  { id: 'training', name: 'Training LNN', icon: '🎯' },
  { id: 'checking', name: 'Checking for Errors', icon: '🔍' },
  { id: 'testing', name: 'Testing LNN Behavior', icon: '🧪' },
  { id: 'finalizing', name: 'Finalizing Model', icon: '✅' },
  { id: 'complete', name: 'Complete!', icon: '🎉' }
];

const DEPLOY_STEPS = [
  { id: 'deploying', name: 'Uploading to Render...', icon: '☁️' },
  { id: 'updating_config', name: 'Updating multi-model config...', icon: '⚙️' },
  { id: 'redeploying', name: 'Redeploying brain service...', icon: '🔄' },
  { id: 'waiting_live', name: 'Waiting for service to go live...', icon: '⏳' },
  { id: 'deploy_complete', name: 'Brain service live!', icon: '🚀' }
];

function AiChat() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [generateStatus, setGenerateStatus] = useState('idle');
  const [modelConfig, setModelConfig] = useState(null);
  const [modelId, setModelId] = useState(null);
  const [deployStatus, setDeployStatus] = useState('idle');
  const [deployResult, setDeployResult] = useState(null);
  const [robotId, setRobotId] = useState(null);
  const [robotData, setRobotData] = useState(null);
  const [pins, setPins] = useState([]);
  const [error, setError] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState({ field: null, timeout: null });
  const [generateProgress, setGenerateProgress] = useState(null);
  const [deployProgress, setDeployProgress] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, generateProgress, deployProgress]);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (window.aironeAPI?.onGenerateProgress) {
      window.aironeAPI.onGenerateProgress((progressData) => {
        setGenerateProgress(progressData);

        if (progressData.step === 'complete' || progressData.model_id) {
          setGenerateStatus('ready');
          if (progressData.config) setModelConfig(progressData.config);
          if (progressData.model_id) setModelId(progressData.model_id);

          const accuracyText = progressData.accuracy
            ? ` Accuracy: ${(progressData.accuracy * 100).toFixed(1)}%`
            : '';
          const accuracyWarning = progressData.accuracy && progressData.accuracy < 0.6
            ? '\n\n⚠️ Training accuracy is below 60%. A rule-based fallback will be used on the brain server to ensure reliable behavior.'
            : '';
          const trainingInfo = progressData.config?.training_info;
          const trainingDetails = trainingInfo
            ? `\nTraining: ${trainingInfo.epochs || 'N/A'} epochs, ${trainingInfo.training_examples || 'N/A'} examples, loss=${trainingInfo.final_loss?.toFixed(4) || 'N/A'}`
            : '';
          const assistantMessage = {
            id: Date.now().toString(),
            role: 'assistant',
            content: `⚡ LNN Model Generated & Trained!${accuracyText}${accuracyWarning}${trainingDetails}\n\nModel ID: ${progressData.model_id || 'N/A'}\nThe model has been trained with synthetic data and verified.\n\nClick "Deploy to Cloud" to make it available for your robot.`,
            timestamp: new Date().toISOString()
          };
          setMessages(prev => [...prev, assistantMessage]);
          setTimeout(() => setGenerateProgress(null), 2000);
        }
      });
    }
    return () => { window.aironeAPI?.removeAllListeners?.('ai:generateProgress'); };
  }, []);

  const loadData = async () => {
    try {
      const robots = await window.aironeAPI.getAllRobots();
      if (robots && robots.length > 0) {
        const first = robots[0];
        setRobotId(first.id);
        setRobotData(first);
        const pinsResult = await window.aironeAPI.getPins(first.id);
        setPins(pinsResult || []);

        if (window.aironeAPI.getChatHistory) {
          try {
            const history = await window.aironeAPI.getChatHistory(first.id);
            if (history?.length > 0) setMessages(history);
          } catch (_e) { }
        }

        if (window.aironeAPI.getLatestLnnModel) {
          try {
            const model = await window.aironeAPI.getLatestLnnModel(first.id);
            if (model) {
              setModelConfig(model.config || model.model_config || model);
              setModelId(model.id);
              if (model.brain_url) {
                setDeployResult({
                  brain_url: model.brain_url,
                  api_key: model.brain_api_key || model.api_key,
                  service_id: model.render_service_id || model.service_id
                });
                setDeployStatus('deployed');
              }
              setGenerateStatus('ready');
            }
          } catch (_e) { }
        }
      }
    } catch (e) {
      setError('Failed to load robot data. Please configure a robot first.');
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isSending) return;
    const userMessage = { id: Date.now().toString(), role: 'user', content: inputText.trim(), timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setIsSending(true);
    setError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      if (window.aironeAPI.sendAiChat) {
        const response = await window.aironeAPI.sendAiChat({ robotId, messages: newMessages, pins, robotData });
        const assistantMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: response.content || response, timestamp: new Date().toISOString() };
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (e) {
      setError('Failed to send message: ' + e.message);
    } finally {
      setIsSending(false);
    }
  };

  const getStepStatus = (stepId) => {
    if (!generateProgress) return 'pending';
    const stepOrder = GENERATION_STEPS.map(s => s.id);
    const currentIdx = stepOrder.indexOf(generateProgress.step);
    const thisIdx = stepOrder.indexOf(stepId);
    if (currentIdx === -1) return 'pending';
    if (thisIdx < currentIdx) return 'completed';
    if (thisIdx === currentIdx) return 'active';
    return 'pending';
  };

  const getDeployStepStatus = (stepId) => {
    if (!deployProgress) return 'pending';
    const stepOrder = DEPLOY_STEPS.map(s => s.id);
    const currentIdx = stepOrder.indexOf(deployProgress.step);
    const thisIdx = stepOrder.indexOf(stepId);
    if (currentIdx === -1) return 'pending';
    if (thisIdx < currentIdx) return 'completed';
    if (thisIdx === currentIdx) return 'active';
    return 'pending';
  };

  const handleGenerate = async () => {
    if (!robotId || pins.length === 0) return;
    setGenerateStatus('generating');
    setGenerateProgress({ step: 'generating', progress: 0 });
    setError(null);

    try {
      if (window.aironeAPI.generateLnnModelStream) {
        await window.aironeAPI.generateLnnModelStream({ robotId, robotData, pins, messages });
      } else if (window.aironeAPI.generateLnnModel) {
        const result = await window.aironeAPI.generateLnnModel({ robotId, robotData, pins, messages });
        setModelConfig(result.config || result.modelConfig || result);
        setModelId(result.modelId || result.id);
        setGenerateStatus('ready');
        setGenerateProgress(null);
      }
    } catch (e) {
      setGenerateStatus('error');
      setGenerateProgress(null);
      setError('Model generation failed: ' + e.message);
    }
  };

  const handleDeploy = async () => {
    if (!robotId || !modelConfig) return;
    setDeployStatus('deploying');
    setDeployProgress({ step: 'deploying', message: 'Uploading model to Render...' });
    setError(null);

    try {
      if (window.aironeAPI.deployBrainService) {
        setDeployProgress({ step: 'updating_config', message: 'Updating multi-model config on brain service...' });

        const result = await window.aironeAPI.deployBrainService({ robotId, modelConfig });

        setDeployProgress({ step: 'redeploying', message: 'Triggering brain service redeploy...' });
        await new Promise(r => setTimeout(r, 1000));

        setDeployProgress({ step: 'waiting_live', message: 'Waiting for service to go live...' });

        setDeployResult(result);
        setDeployStatus('deployed');
        setDeployProgress({ step: 'deploy_complete', message: 'Brain service is live!' });

        if (result.brain_url) {
          try { await window.aironeAPI.updateRobot(robotId, { brain_url: result.brain_url }); } catch (_e) { }
        }

        const wsUrl = result.ws_url || result.brain_url.replace('https://', 'wss://').replace('http://', 'ws://');
        const multiModelNote = result.multi_model
          ? `\n\nMulti-model: ${result.total_robots} robot(s) sharing this brain service.\nConnect via: ${wsUrl}?robot=${result.robot_key || 'your-robot-name'}`
          : '';
        const assistantMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `🚀 Brain Service Deployed!\n\nYour trained LNN model is now live in the cloud.\n\nBrain URL: ${result.brain_url}\nWebSocket: ${wsUrl}${multiModelNote}`,
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, assistantMessage]);
        setTimeout(() => setDeployProgress(null), 3000);
      }
    } catch (e) {
      setDeployStatus('error');
      setDeployProgress(null);
      setError('Deployment failed: ' + e.message);
    }
  };

  const handleCopy = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      if (copyFeedback.timeout) clearTimeout(copyFeedback.timeout);
      setCopyFeedback({ field, timeout: null });
      const timeout = setTimeout(() => setCopyFeedback(prev => ({ ...prev, field: null })), 2000);
      setCopyFeedback({ field, timeout });
    } catch (_e) { }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const handleTextareaChange = (e) => {
    setInputText(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  const inputPinCount = pins.filter(p => p.mode === 'input').length;
  const outputPinCount = pins.filter(p => p.mode === 'output').length;

  const formatTimestamp = (ts) => {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  };

  const getProgressPercent = () => {
    if (!generateProgress) return 0;
    if (generateProgress.progress) return generateProgress.progress;
    const stepOrder = GENERATION_STEPS.map(s => s.id);
    const idx = stepOrder.indexOf(generateProgress.step);
    if (idx === -1) return 0;
    return Math.round(((idx + 1) / stepOrder.length) * 100);
  };

  return (
    <div className="ai-chat fade-in">
      {/* Styles */}
      <style>{`
        @keyframes lnn-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .lnn-progress-panel { background: #1a1f3a; border: 1px solid #2d3561; border-radius: 12px; padding: 16px; margin: 8px 0; color: #e0e0ff; font-size: 13px; }
        .progress-header { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; margin-bottom: 14px; color: #fff; }
        .progress-steps { display: flex; flex-direction: column; gap: 2px; margin-bottom: 14px; }
        .progress-step { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px; border-left: 3px solid transparent; transition: all 0.3s ease; }
        .progress-step.completed { border-left-color: #22c55e; color: #86efac; }
        .progress-step.active { border-left-color: #3b82f6; background: rgba(59,130,246,0.08); color: #fff; }
        .progress-step.pending { border-left-color: #4b5563; color: #6b7280; }
        .step-indicator { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; font-size: 14px; flex-shrink: 0; }
        .progress-step.active .step-indicator { animation: lnn-spin 1.2s linear infinite; color: #60a5fa; font-size: 16px; }
        .progress-step.completed .step-indicator { color: #22c55e; font-weight: bold; }
        .step-name { flex: 1; font-size: 13px; }
        .step-message { font-size: 11px; color: #93c5fd; margin-left: auto; font-style: italic; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .progress-bar-container { position: relative; height: 22px; background: #0f1330; border-radius: 11px; overflow: hidden; margin-bottom: 10px; }
        .progress-bar { height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4); border-radius: 11px; transition: width 0.5s ease; position: relative; }
        .progress-bar::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent); animation: progress-shimmer 2s infinite; }
        @keyframes progress-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        .progress-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 11px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
        .progress-accuracy { font-size: 12px; color: #34d399; margin-top: 4px; text-align: right; }
        .deploy-progress-panel { background: #1a1f3a; border: 1px solid #2d3561; border-radius: 12px; padding: 16px; margin: 8px 0; color: #e0e0ff; font-size: 13px; }
        .deploy-progress-panel .progress-step.active { border-left-color: #06b6d4; background: rgba(6,182,212,0.08); }
        .deploy-progress-panel .progress-step.active .step-indicator { animation: lnn-spin 1.2s linear infinite; color: #22d3ee; }
        .deploy-url-field { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
        .deploy-url-field label { font-size: 11px; color: #93c5fd; min-width: 100px; font-weight: 600; }
        .deploy-url-field code { flex: 1; font-size: 12px; color: #e0e0ff; background: #0f1330; padding: 6px 10px; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .copy-btn { padding: 4px 10px; font-size: 11px; background: #2d3561; color: #e0e0ff; border: 1px solid #3d4575; border-radius: 6px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
        .copy-btn:hover { background: #3d4575; }
        .multi-model-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: rgba(6,182,212,0.15); border: 1px solid rgba(6,182,212,0.3); border-radius: 6px; font-size: 11px; color: #22d3ee; margin-top: 8px; }
      `}</style>

      {/* Page Header */}
      <div className="page-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <h2>AI Chat</h2>
      </div>

      {/* Context Bar */}
      <div className="ai-chat-context-bar">
        <span className="context-robot-name">{robotData ? (robotData.name || 'Unnamed Robot') : 'No Robot Selected'}</span>
        {robotData?.type && <><span className="context-divider">|</span><span className="context-robot-type">{robotData.type}</span></>}
        <span className="context-divider">|</span>
        <span className="context-pin-count">{pins.length} pins ({inputPinCount} in / {outputPinCount} out)</span>
        {generateStatus === 'ready' && <><span className="context-divider">|</span><span className="chip chip-green">LNN Trained{generateProgress?.accuracy ? ` (${(generateProgress.accuracy * 100).toFixed(0)}%)` : ''}</span></>}
        {deployStatus === 'deployed' && <><span className="context-divider">|</span><span className="chip chip-cyan">Deployed</span></>}
      </div>

      {/* Chat Messages */}
      <div className="chat-messages">
        <div className="chat-message system">
          <div className="chat-message-content">
            Welcome to Airone AI! Describe your robot and I'll generate, train, and deploy an LNN model for it. The AI will create synthetic training data, train the network, and verify it works correctly.
          </div>
        </div>

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div className="chat-message-role">{msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'AI' : 'System'}</div>
            <div className="chat-message-content">
              {msg.content.split('\n').map((line, i) => (
                <React.Fragment key={i}>{line}{i < msg.content.split('\n').length - 1 && <br />}</React.Fragment>
              ))}
            </div>
            <div className="chat-message-time">{formatTimestamp(msg.timestamp)}</div>
          </div>
        ))}

        {/* Generation Progress */}
        {generateProgress && generateStatus === 'generating' && (
          <div className="chat-message assistant">
            <div className="chat-message-role">AI</div>
            <div className="chat-message-content" style={{ padding: 0, background: 'transparent', border: 'none' }}>
              <div className="lnn-progress-panel">
                <div className="progress-header">
                  <span>🧠</span>
                  <span>Generating & Training LNN for {robotData?.name || 'Robot'}</span>
                </div>
                <div className="progress-steps">
                  {GENERATION_STEPS.map((step) => (
                    <div key={step.id} className={`progress-step ${getStepStatus(step.id)}`}>
                      <span className="step-indicator">
                        {getStepStatus(step.id) === 'completed' ? '✓' : getStepStatus(step.id) === 'active' ? '⟳' : '○'}
                      </span>
                      <span className="step-name">{step.icon} {step.name}</span>
                      {generateProgress.step === step.id && generateProgress.message && (
                        <span className="step-message">{generateProgress.message}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar" style={{ width: `${getProgressPercent()}%` }} />
                  <span className="progress-text">{getProgressPercent()}%</span>
                </div>
                {generateProgress.accuracy !== undefined && (
                  <div className="progress-accuracy" style={{ color: generateProgress.accuracy >= 0.6 ? '#34d399' : generateProgress.accuracy >= 0.4 ? '#fbbf24' : '#f87171' }}>
                    Training accuracy: {(generateProgress.accuracy * 100).toFixed(1)}%{generateProgress.accuracy < 0.6 ? ' (rule-based fallback will be used)' : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Deploy Progress */}
        {deployProgress && deployStatus === 'deploying' && (
          <div className="chat-message assistant">
            <div className="chat-message-role">AI</div>
            <div className="chat-message-content" style={{ padding: 0, background: 'transparent', border: 'none' }}>
              <div className="deploy-progress-panel">
                <div className="progress-header">
                  <span>🚀</span>
                  <span>Deploying to Brain Service (Multi-Model)</span>
                </div>
                <div className="progress-steps">
                  {DEPLOY_STEPS.map((step) => (
                    <div key={step.id} className={`progress-step ${getDeployStepStatus(step.id)}`}>
                      <span className="step-indicator">
                        {getDeployStepStatus(step.id) === 'completed' ? '✓' : getDeployStepStatus(step.id) === 'active' ? '⟳' : '○'}
                      </span>
                      <span className="step-name">{step.icon} {step.name}</span>
                      {deployProgress.step === step.id && deployProgress.message && (
                        <span className="step-message">{deployProgress.message}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {isSending && (
          <div className="chat-message assistant">
            <div className="chat-message-role">AI</div>
            <div className="chat-message-content"><span className="generating-indicator">Thinking...</span></div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Action Bar */}
      <div className="chat-actions">
        <button
          className={`btn ${generateStatus === 'ready' ? 'btn-secondary' : generateStatus === 'generating' ? 'btn-secondary' : 'btn-primary'}`}
          onClick={handleGenerate}
          disabled={!robotId || pins.length === 0 || generateStatus === 'generating'}
        >
          {generateStatus === 'generating' ? <span className="generating-indicator">Generating & Training...</span>
            : generateStatus === 'ready' ? '✓ Model Trained!'
            : generateStatus === 'error' ? '⚡ Retry Generate & Train'
            : '⚡ Generate & Train LNN'}
        </button>

        {generateStatus === 'ready' && (
          <button
            className={`btn ${deployStatus === 'deployed' ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleDeploy}
            disabled={deployStatus === 'deploying'}
          >
            {deployStatus === 'deploying' ? <span className="generating-indicator">Deploying...</span>
              : deployStatus === 'deployed' ? '✓ Deployed!'
              : deployStatus === 'error' ? '🚀 Retry Deploy'
              : '🚀 Deploy to Cloud'}
          </button>
        )}
      </div>

      {/* Deploy Result */}
      {deployStatus === 'deployed' && deployResult && (
        <div className="deploy-result-panel">
          <h4>Brain Service Deployed {deployResult.multi_model && '(Multi-Model)'}</h4>
          <p className="deploy-instructions">
            Use these URLs in the Airone IDE to connect your robot.
            {deployResult.multi_model && ' Multiple robots share this brain service - each routed by robot name.'}
          </p>
          <div className="deploy-url-field">
            <label>Brain URL</label>
            <code className="deploy-url">{deployResult.brain_url}</code>
            <button className="copy-btn" onClick={() => handleCopy(deployResult.brain_url, 'brain_url')}>
              {copyFeedback.field === 'brain_url' ? '✓' : 'Copy'}
            </button>
          </div>
          <div className="deploy-url-field">
            <label>WebSocket URL</label>
            <code className="deploy-url">{deployResult.brain_url.replace('https://', 'wss://').replace('http://', 'ws://')}</code>
            <button className="copy-btn" onClick={() => handleCopy(deployResult.brain_url.replace('https://', 'wss://').replace('http://', 'ws://'), 'ws_url')}>
              {copyFeedback.field === 'ws_url' ? '✓' : 'Copy'}
            </button>
          </div>
          {deployResult.api_key && (
            <div className="deploy-url-field">
              <label>Robot Key</label>
              <code className="deploy-url">{deployResult.api_key}</code>
              <button className="copy-btn" onClick={() => handleCopy(deployResult.api_key, 'api_key')}>
                {copyFeedback.field === 'api_key' ? '✓' : 'Copy'}
              </button>
            </div>
          )}
          {deployResult.multi_model && (
            <div className="multi-model-badge">
              🧠 {deployResult.total_robots} robot(s) on this brain service
            </div>
          )}
        </div>
      )}

      {/* Input Area */}
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="form-textarea chat-textarea"
          value={inputText}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder="Describe your robot or ask about LNN models..."
          rows={1}
          disabled={isSending}
        />
        <button className="btn btn-primary chat-send-btn" onClick={handleSendMessage} disabled={!inputText.trim() || isSending}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>✗ {error}</div>}
    </div>
  );
}

export default AiChat;
