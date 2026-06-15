import React, { useState, useEffect } from 'react';
import './HardwareMap.css';

function HardwareMap() {
  const [pins, setPins] = useState([]);
  const [robotId, setRobotId] = useState(null);
  const [synced, setSynced] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingPin, setEditingPin] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRobotAndPins();
  }, []);

  const loadRobotAndPins = async () => {
    try {
      const robots = await window.aironeAPI.getAllRobots();
      if (robots && robots.length > 0) {
        const robot = robots[0];
        setRobotId(robot.id);
        const pinData = await window.aironeAPI.getPins(robot.id);
        setPins(pinData || []);
      }
    } catch (e) {
      console.error('Failed to load data:', e);
    }
  };

  const handleSyncFromIDE = async () => {
    if (!robotId) {
      setError('No robot configured. Please set up a robot identity first.');
      return;
    }

    // Sample pins for demo (simulating IDE sync)
    const samplePins = [
      { name: 'ledpin', number: 2, mode: 'output', description: 'Status LED - shows robot state' },
      { name: 'temperature_sensor', number: 35, mode: 'input', description: 'DHT22 - monitors overheating' },
      { name: 'ultrasonic', number: 34, mode: 'input', description: 'HC-SR04 - detects obstacles' },
      { name: 'camera', number: 33, mode: 'input', description: 'OV2640 - identifies objects' },
      { name: 'microphone', number: 32, mode: 'input', description: 'INMP441 - voice commands' }
    ];

    try {
      const count = await window.aironeAPI.syncPins(robotId, samplePins);
      setSynced(true);
      setError(null);
      const pinData = await window.aironeAPI.getPins(robotId);
      setPins(pinData || []);
    } catch (e) {
      setError('Sync failed: ' + e.message);
    }
  };

  const handleImportAiro = async () => {
    setImporting(true);
    setError(null);

    try {
      const result = await window.aironeAPI.openAiroFile();
      if (!result) {
        setImporting(false);
        return; // User cancelled
      }

      if (!robotId) {
        setError('No robot configured. Please set up a robot identity first.');
        setImporting(false);
        return;
      }

      const { pins: airoPins } = result;

      if (airoPins.length === 0) {
        setError('No pin definitions found in the .airo file. Make sure it contains a "pin defi { ... }" block.');
        setImporting(false);
        return;
      }

      const count = await window.aironeAPI.syncPins(robotId, airoPins);
      setSynced(true);
      const pinData = await window.aironeAPI.getPins(robotId);
      setPins(pinData || []);
    } catch (e) {
      setError('Import failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  const handleDescriptionChange = (pinId, value) => {
    setPins(pins.map(p => p.id === pinId ? { ...p, description: value } : p));
    setEditingPin(pinId);
  };

  const handleSaveDescription = async (pinId) => {
    const pin = pins.find(p => p.id === pinId);
    if (!pin) return;

    try {
      await window.aironeAPI.updatePinDescription(pinId, pin.description);
      setEditingPin(null);
    } catch (e) {
      setError('Failed to save description: ' + e.message);
    }
  };

  const handleKeyDown = (e, pinId) => {
    if (e.key === 'Enter') {
      handleSaveDescription(pinId);
    }
  };

  const getModeChipClass = (mode) => {
    return mode === 'output' ? 'chip-cyan' : 'chip-purple';
  };

  const inputCount = pins.filter(p => p.mode === 'input').length;
  const outputCount = pins.filter(p => p.mode === 'output').length;

  return (
    <div className="hardware-map fade-in">
      <div className="page-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
          <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
        </svg>
        <h2>Hardware Map</h2>
      </div>

      {/* Stats bar */}
      {pins.length > 0 && (
        <div className="hw-stats">
          <div className="hw-stat">
            <span className="hw-stat-value">{pins.length}</span>
            <span className="hw-stat-label">Total Pins</span>
          </div>
          <div className="hw-stat">
            <span className="hw-stat-value">{inputCount}</span>
            <span className="hw-stat-label">Inputs</span>
          </div>
          <div className="hw-stat">
            <span className="hw-stat-value">{outputCount}</span>
            <span className="hw-stat-label">Outputs</span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="hw-actions">
        <button className="btn btn-primary" onClick={handleSyncFromIDE}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Sync from IDE
        </button>
        <button className="btn btn-secondary" onClick={handleImportAiro} disabled={importing}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Import .airo File
        </button>
        {synced && <span className="chip chip-green">Synced!</span>}
      </div>

      {error && (
        <div className="alert alert-error">{error}</div>
      )}

      {/* Pin table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Pin Definitions</h3>
        </div>
        <p className="card-subtitle">
          Describe what each pin does. The AI uses these descriptions to make better decisions.
          Example: "Right hand servo - picks up objects up to 500g"
        </p>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pin Name</th>
                <th>GPIO</th>
                <th>Mode</th>
                <th style={{ width: '50%' }}>Description (editable)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pins.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={5}>
                    No pins synced yet. Click "Sync from IDE" to import sample data,
                    or "Import .airo File" to parse from your robot code.
                  </td>
                </tr>
              ) : (
                pins.map((pin) => (
                  <tr key={pin.id}>
                    <td><strong className="pin-name">{pin.pin_name}</strong></td>
                    <td><code className="pin-gpio">GPIO{pin.pin_number}</code></td>
                    <td>
                      <span className={`chip ${getModeChipClass(pin.mode)}`}>
                        {pin.mode}
                      </span>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="form-input pin-desc-input"
                        value={pin.description || ''}
                        onChange={(e) => handleDescriptionChange(pin.id, e.target.value)}
                        onBlur={() => handleSaveDescription(pin.id)}
                        onKeyDown={(e) => handleKeyDown(e, pin.id)}
                        placeholder="Describe what this pin does..."
                      />
                    </td>
                    <td>
                      {editingPin === pin.id && (
                        <button
                          className="btn btn-primary btn-small"
                          onClick={() => handleSaveDescription(pin.id)}
                        >
                          Save
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default HardwareMap;
