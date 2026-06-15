/**
 * Airone AI Backbone - Robot Identity Component
 * Create, configure, and manage robot identities.
 * Provides form for robot name, type, purpose, environment, and brain URL.
 * Includes robot preview and list of configured robots.
 */

import React, { useState, useEffect } from 'react';

const ROBOT_TYPES = [
  'Humanoid robot',
  'Wheeled robot',
  'Drone',
  'Robot arm',
  'Custom'
];

const ENVIRONMENTS = [
  'Indoor warehouse',
  'Outdoor field',
  'Laboratory',
  'Hazardous zone',
  'Home',
  'Custom'
];

function RobotIdentity() {
  const [form, setForm] = useState({
    name: '',
    type: 'Humanoid robot',
    purpose: '',
    environment: 'Indoor warehouse',
    brain_url: ''
  });
  const [saved, setSaved] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [robots, setRobots] = useState([]);

  useEffect(() => {
    loadRobots();
  }, []);

  const loadRobots = async () => {
    try {
      const result = await window.aironeAPI.getAllRobots();
      setRobots(result);
      if (result && result.length > 0) {
        const first = result[0];
        setSelectedId(first.id);
        setForm({
          name: first.name || '',
          type: first.type || 'Humanoid robot',
          purpose: first.purpose || '',
          environment: first.environment || 'Indoor warehouse',
          brain_url: first.brain_url || ''
        });
      }
    } catch (e) {
      console.error('Failed to load robots:', e);
    }
  };

  const handleChange = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    try {
      if (selectedId) {
        await window.aironeAPI.updateRobot(selectedId, form);
      } else {
        const result = await window.aironeAPI.createRobot(form);
        setSelectedId(result.id);
      }
      setSaved(true);
      loadRobots();
    } catch (e) {
      setError('Failed to save. ' + (e.message || 'Unknown error'));
    }
  };

  const handleNew = () => {
    setSelectedId(null);
    setForm({
      name: '',
      type: 'Humanoid robot',
      purpose: '',
      environment: 'Indoor warehouse',
      brain_url: ''
    });
    setSaved(false);
    setError(null);
  };

  return (
    <div className="robot-identity fade-in">
      <div className="page-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
          <circle cx="8" cy="16" r="1" />
          <circle cx="16" cy="16" r="1" />
        </svg>
        <h2>Robot Identity</h2>
      </div>

      <div className="grid grid-2">
        {/* Form Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Define Your Robot</h3>
          </div>
          <p className="card-subtitle">
            Tell the AI what kind of robot you are building. This information helps the brain server
            make better decisions for your specific robot configuration.
          </p>

          <div className="form-group">
            <label className="form-label">Robot Name</label>
            <input
              type="text"
              className="form-input"
              value={form.name}
              onChange={handleChange('name')}
              placeholder="e.g., Zeeb"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Robot Type</label>
            <select className="form-select" value={form.type} onChange={handleChange('type')}>
              {ROBOT_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Purpose / What should it do?</label>
            <textarea
              className="form-textarea"
              value={form.purpose}
              onChange={handleChange('purpose')}
              placeholder="Example: Pick up objects and sort them by color"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Environment</label>
            <select className="form-select" value={form.environment} onChange={handleChange('environment')}>
              {ENVIRONMENTS.map(env => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Brain URL</label>
            <input
              type="text"
              className="form-input"
              value={form.brain_url}
              onChange={handleChange('brain_url')}
              placeholder="ws://localhost:8080"
            />
            <div className="form-hint">WebSocket URL where the AI brain lives</div>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleSave}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              Save Identity
            </button>
            <button className="btn btn-secondary" onClick={handleNew}>
              New Robot
            </button>
          </div>

          {saved && (
            <div className="alert alert-success" style={{ marginTop: 16 }}>
              ✓ Robot identity saved successfully!
            </div>
          )}
          {error && (
            <div className="alert alert-error" style={{ marginTop: 16 }}>
              ✗ {error}
            </div>
          )}
        </div>

        {/* Preview & List */}
        <div>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Robot Preview</h3>
            </div>
            {form.name ? (
              <div className="robot-preview">
                <div className="robot-preview-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <circle cx="12" cy="5" r="2" />
                    <path d="M12 7v4" />
                    <circle cx="8" cy="16" r="1" />
                    <circle cx="16" cy="16" r="1" />
                  </svg>
                </div>
                <div className="robot-preview-name">{form.name}</div>
                <div className="robot-preview-type">{form.type}</div>
                <div className="robot-preview-details">
                  {form.purpose && (
                    <div className="preview-row">
                      <span className="preview-label">Purpose</span>
                      <span className="preview-value">{form.purpose}</span>
                    </div>
                  )}
                  <div className="preview-row">
                    <span className="preview-label">Environment</span>
                    <span className="preview-value">{form.environment}</span>
                  </div>
                  <div className="preview-row">
                    <span className="preview-label">Brain URL</span>
                    <span className="preview-value preview-mono">
                      {form.brain_url || 'Not set'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="robot-preview-empty">
                <p>Fill in the form to see a preview of your robot configuration.</p>
              </div>
            )}
          </div>

          {robots.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Configured Robots</h3>
              </div>
              <div className="robot-list">
                {robots.map(robot => (
                  <div
                    key={robot.id}
                    className={`robot-list-item ${robot.id === selectedId ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedId(robot.id);
                      setForm({
                        name: robot.name,
                        type: robot.type,
                        purpose: robot.purpose,
                        environment: robot.environment,
                        brain_url: robot.brain_url
                      });
                      setSaved(false);
                    }}
                  >
                    <div className="robot-list-name">{robot.name}</div>
                    <div className="robot-list-meta">
                      <span className="chip chip-cyan">{robot.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RobotIdentity;
