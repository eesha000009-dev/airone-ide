import React, { useState, useEffect } from 'react';
import './RobotIdentity.css';

const robotTypes = [
  'Humanoid robot',
  'Wheeled robot',
  'Drone',
  'Robot arm',
  'Custom'
];

const environments = [
  'Indoor warehouse',
  'Outdoor field',
  'Laboratory',
  'Hazardous zone',
  'Home',
  'Custom'
];

function RobotIdentity() {
  const [formData, setFormData] = useState({
    name: '',
    type: 'Humanoid robot',
    purpose: '',
    environment: 'Indoor warehouse',
    brain_url: ''
  });
  const [saved, setSaved] = useState(false);
  const [robotId, setRobotId] = useState(null);
  const [error, setError] = useState(null);
  const [existingRobots, setExistingRobots] = useState([]);

  useEffect(() => {
    loadRobots();
  }, []);

  const loadRobots = async () => {
    try {
      const robots = await window.aironeAPI.getAllRobots();
      setExistingRobots(robots);
      
      // Load the first robot if it exists
      if (robots && robots.length > 0) {
        const robot = robots[0];
        setRobotId(robot.id);
        setFormData({
          name: robot.name || '',
          type: robot.type || 'Humanoid robot',
          purpose: robot.purpose || '',
          environment: robot.environment || 'Indoor warehouse',
          brain_url: robot.brain_url || ''
        });
      }
    } catch (e) {
      console.error('Failed to load robots:', e);
    }
  };

  const handleChange = (field) => (event) => {
    setFormData({ ...formData, [field]: event.target.value });
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    try {
      if (robotId) {
        // Update existing robot
        await window.aironeAPI.updateRobot(robotId, formData);
      } else {
        // Create new robot
        const result = await window.aironeAPI.createRobot(formData);
        setRobotId(result.id);
      }
      setSaved(true);
      loadRobots();
    } catch (err) {
      setError('Failed to save. ' + (err.message || 'Unknown error'));
    }
  };

  const handleNew = () => {
    setRobotId(null);
    setFormData({
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
          <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>
        </svg>
        <h2>Robot Identity</h2>
      </div>

      <div className="grid grid-2">
        {/* Robot Form Card */}
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
              value={formData.name}
              onChange={handleChange('name')}
              placeholder="e.g., Zeeb"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Robot Type</label>
            <select
              className="form-select"
              value={formData.type}
              onChange={handleChange('type')}
            >
              {robotTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Purpose / What should it do?</label>
            <textarea
              className="form-textarea"
              value={formData.purpose}
              onChange={handleChange('purpose')}
              placeholder="Example: Pick up objects and sort them by color"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Environment</label>
            <select
              className="form-select"
              value={formData.environment}
              onChange={handleChange('environment')}
            >
              {environments.map((env) => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Brain URL</label>
            <input
              type="text"
              className="form-input"
              value={formData.brain_url}
              onChange={handleChange('brain_url')}
              placeholder="ws://localhost:8080"
            />
            <div className="form-hint">WebSocket URL where the AI brain lives</div>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleSave}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
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

        {/* Robot Preview Card */}
        <div>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Robot Preview</h3>
            </div>
            
            {formData.name ? (
              <div className="robot-preview">
                <div className="robot-preview-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64">
                    <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>
                  </svg>
                </div>
                <div className="robot-preview-name">{formData.name}</div>
                <div className="robot-preview-type">{formData.type}</div>
                
                <div className="robot-preview-details">
                  {formData.purpose && (
                    <div className="preview-row">
                      <span className="preview-label">Purpose</span>
                      <span className="preview-value">{formData.purpose}</span>
                    </div>
                  )}
                  <div className="preview-row">
                    <span className="preview-label">Environment</span>
                    <span className="preview-value">{formData.environment}</span>
                  </div>
                  <div className="preview-row">
                    <span className="preview-label">Brain URL</span>
                    <span className="preview-value preview-mono">{formData.brain_url || 'Not set'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="robot-preview-empty">
                <p>Fill in the form to see a preview of your robot configuration.</p>
              </div>
            )}
          </div>

          {/* Existing Robots Card */}
          {existingRobots.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Configured Robots</h3>
              </div>
              <div className="robot-list">
                {existingRobots.map((robot) => (
                  <div
                    key={robot.id}
                    className={`robot-list-item ${robot.id === robotId ? 'selected' : ''}`}
                    onClick={() => {
                      setRobotId(robot.id);
                      setFormData({
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
