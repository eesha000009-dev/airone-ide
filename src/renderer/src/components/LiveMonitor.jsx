/**
 * Airone AI Backbone - Live Monitor Component
 * Real-time sensor data display and AI command monitoring.
 * Features: connection status, sensor data grid, command history,
 * emergency stop/release, and real-time event streaming.
 */

import React, { useState, useEffect } from 'react';

function LiveMonitor() {
  const [brainStatus, setBrainStatus] = useState({ running: false, port: 8080 });
  const [connectedRobots, setConnectedRobots] = useState([]);
  const [selectedRobot, setSelectedRobot] = useState(null);
  const [sensorData, setSensorData] = useState(null);
  const [sensorEntries, setSensorEntries] = useState([]);
  const [commandLogs, setCommandLogs] = useState([]);
  const [realtimeEvents, setRealtimeEvents] = useState([]);
  const [emergencyActive, setEmergencyActive] = useState(false);

  // Poll brain server status
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await window.aironeAPI.getBrainServerStatus();
        setBrainStatus(status);
        setConnectedRobots(status.connectedRobots || []);
      } catch (e) {
        // Server not available
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  // Listen for real-time events
  useEffect(() => {
    window.aironeAPI?.onSensorData?.((event) => {
      const data = event.data?.data;
      if (data) {
        setSensorData(data);
        const entries = Object.entries(data.input_sensors_read || {}).map(([key, value]) => ({ key, value }));
        setSensorEntries(entries);

        // Add to realtime events
        const logEntry = {
          id: Date.now(),
          direction: 'received',
          timestamp: new Date().toLocaleTimeString(),
          message: `Sensor data from ${event.data?.robotId || 'unknown'}`,
          commands: data.input_sensors_read
        };
        setRealtimeEvents(prev => [logEntry, ...prev].slice(0, 50));
      }
    });

    window.aironeAPI?.onCommandSent?.((event) => {
      const logEntry = {
        id: Date.now(),
        direction: 'sent',
        timestamp: new Date().toLocaleTimeString(),
        message: `Command sent to ${event.data?.robotId || 'unknown'}`,
        commands: event.data?.response?.output_commands
      };
      setRealtimeEvents(prev => [logEntry, ...prev].slice(0, 50));
    });

    // Load database command logs when a robot is selected
    const loadLogs = async () => {
      if (selectedRobot) {
        try {
          const logs = await window.aironeAPI.getCommandLogs(selectedRobot, 100);
          setCommandLogs(logs || []);
        } catch (e) {
          console.error('Failed to load logs:', e);
        }
      }
    };
    loadLogs();

    return () => {
      window.aironeAPI?.removeAllListeners?.('brain:sensorData');
      window.aironeAPI?.removeAllListeners?.('brain:commandSent');
      window.aironeAPI?.removeAllListeners?.('brain:connectionChange');
    };
  }, [selectedRobot]);

  // Load command logs from database
  useEffect(() => {
    const loadLogs = async () => {
      if (selectedRobot) {
        try {
          const logs = await window.aironeAPI.getCommandLogs(selectedRobot, 100);
          setCommandLogs(logs || []);
        } catch (e) {
          console.error('Failed to load logs:', e);
        }
      }
    };
    loadLogs();
  }, [selectedRobot]);

  const handleRefresh = async () => {
    if (selectedRobot) {
      try {
        const logs = await window.aironeAPI.getCommandLogs(selectedRobot, 100);
        setCommandLogs(logs || []);
      } catch (e) {
        console.error('Failed to refresh logs:', e);
      }
    }
  };

  const handleEmergencyStop = async () => {
    try {
      await window.aironeAPI.emergencyStop(selectedRobot || null);
      setEmergencyActive(true);
    } catch (e) {
      console.error('Emergency stop failed:', e);
    }
  };

  const handleReleaseEmergencyStop = async () => {
    try {
      if (selectedRobot) {
        await window.aironeAPI.releaseEmergencyStop(selectedRobot);
      }
      setEmergencyActive(false);
    } catch (e) {
      console.error('Release failed:', e);
    }
  };

  const handleStartServer = async () => {
    try {
      await window.aironeAPI.stopBrainServer();
      await window.aironeAPI.startBrainServer(brainStatus.port || 8080, '0.0.0.0');
      // Refresh status
      const status = await window.aironeAPI.getBrainServerStatus();
      setBrainStatus(status);
    } catch (e) {
      console.error('Restart failed:', e);
    }
  };

  return (
    <div className="live-monitor fade-in">
      <div className="page-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <h2>Live Monitor</h2>
      </div>

      <div className="grid grid-2">
        {/* Connection Status Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Connection Status</h3>
          </div>

          <div className="status-row">
            <span className={`status-dot ${brainStatus.running ? 'online pulse' : 'offline'}`} />
            <span className={`status-text ${brainStatus.running ? 'online' : 'offline'}`}>
              {brainStatus.running ? 'ONLINE' : 'OFFLINE'}
            </span>
            {brainStatus.running && (
              <span className="status-detail">ws://0.0.0.0:{brainStatus.port}</span>
            )}
          </div>

          {connectedRobots?.length > 0 && (
            <div className="connected-robots">
              <div className="form-label">Connected Robots</div>
              {connectedRobots.map(robotId => (
                <div
                  key={robotId}
                  className={`robot-item ${selectedRobot === robotId ? 'selected' : ''}`}
                  onClick={() => setSelectedRobot(robotId)}
                >
                  <span className="status-dot online" />
                  <span className="robot-item-id">{robotId}</span>
                  <span className="chip chip-green">connected</span>
                </div>
              ))}
            </div>
          )}

          {!brainStatus.running && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={handleStartServer}>
                Start Brain Server
              </button>
            </div>
          )}

          {/* Emergency Stop */}
          <div className="emergency-section">
            {emergencyActive ? (
              <button
                className="btn btn-danger-large emergency-active"
                onClick={handleReleaseEmergencyStop}
              >
                RELEASE EMERGENCY STOP
              </button>
            ) : (
              <button className="btn btn-danger-large" onClick={handleEmergencyStop}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                EMERGENCY STOP
              </button>
            )}
            <div className="emergency-hint">
              {emergencyActive
                ? 'All robot commands are halted. Click to release.'
                : 'Immediately stops all robot movement and commands.'}
            </div>
          </div>
        </div>

        {/* Sensor Data Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Sensor Data</h3>
            {selectedRobot && <span className="chip chip-cyan">{selectedRobot}</span>}
          </div>

          {sensorEntries.length > 0 ? (
            <div className="sensor-grid">
              {sensorEntries.map(({ key, value }) => (
                <div key={key} className="sensor-item">
                  <div className="sensor-key">{key}</div>
                  <div className="sensor-value">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48" style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              <p>No sensor data received yet.</p>
              <p className="no-data-hint">Connect a robot to start seeing live data.</p>
            </div>
          )}

          {sensorData && (
            <div style={{ marginTop: 16 }}>
              <div className="form-label">Raw Data</div>
              <div className="code-block">{JSON.stringify(sensorData, null, 2)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Command History Card */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Command History</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {selectedRobot && (
              <button className="btn btn-secondary btn-small" onClick={handleRefresh}>
                Refresh
              </button>
            )}
          </div>
        </div>

        {realtimeEvents.length > 0 && (
          <div className="realtime-log">
            <div className="form-label">Real-Time Events</div>
            <div className="log-entries">
              {realtimeEvents.map(event => (
                <div key={event.id} className={`log-entry log-${event.direction}`}>
                  <span className="log-time">{event.timestamp}</span>
                  <span className={`log-direction chip ${event.direction === 'sent' ? 'chip-cyan' : 'system' === event.direction ? 'chip-green' : 'chip-purple'}`}>
                    {event.direction}
                  </span>
                  {event.commands && (
                    <span className="log-content">
                      {JSON.stringify(event.commands).substring(0, 120)}
                      {JSON.stringify(event.commands).length > 120 ? '...' : ''}
                    </span>
                  )}
                  {event.message && (
                    <span className="log-content">{event.message}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {commandLogs.length > 0 ? (
          <div style={{ marginTop: realtimeEvents.length > 0 ? 16 : 0 }}>
            {realtimeEvents.length > 0 && <div className="form-label">Database History</div>}
            <div className="log-entries">
              {commandLogs.map((log, index) => (
                <div key={log.id || index} className={`log-entry log-${log.direction}`}>
                  <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className={`log-direction chip ${log.direction === 'sent' ? 'chip-cyan' : 'chip-purple'}`}>
                    {log.direction}
                  </span>
                  <span className="log-content">
                    {typeof log.command === 'string'
                      ? log.command.substring(0, 120) + (log.command.length > 120 ? '...' : '')
                      : JSON.stringify(log.command).substring(0, 120)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : !realtimeEvents.length && (
          <div className="alert alert-info">
            No commands logged yet. Connect a robot and send sensor data to see command history.
          </div>
        )}
      </div>
    </div>
  );
}

export default LiveMonitor;
