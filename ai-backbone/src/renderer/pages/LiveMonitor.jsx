import React, { useState, useEffect, useCallback, useRef } from 'react';
import './LiveMonitor.css';

function LiveMonitor() {
  const [serverStatus, setServerStatus] = useState({ running: false, port: 8080, connectedRobots: [] });
  const [sensorData, setSensorData] = useState(null);
  const [commandLog, setCommandLog] = useState([]);
  const [selectedRobot, setSelectedRobot] = useState(null);
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);

  useEffect(() => {
    // Initial load
    refreshStatus();
    const statusInterval = setInterval(refreshStatus, 2000);
    return () => clearInterval(statusInterval);
  }, []);

  useEffect(() => {
    // Load logs when a robot is selected
    if (selectedRobot) {
      loadLogs();
    }
  }, [selectedRobot]);

  // Listen for real-time brain events
  useEffect(() => {
    const handleSensorData = (event) => {
      const { data } = event;
      if (!selectedRobot || data.robotId === selectedRobot) {
        setSensorData(data.data);
      }
    };

    const handleCommandSent = (event) => {
      const { data } = event;
      const entry = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        direction: 'sent',
        robotId: data.robotId,
        commands: data.response?.output_commands || {},
        metadata: data.response?.metadata || {}
      };
      setLogs(prev => [entry, ...prev].slice(0, 100));
    };

    const handleConnectionChange = (event) => {
      refreshStatus();
      if (event.data?.type === 'client:connected') {
        const entry = {
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          direction: 'system',
          message: `Robot ${event.data?.data?.robotId || event.data?.robotId || 'unknown'} connected`
        };
        setLogs(prev => [entry, ...prev].slice(0, 100));
      }
    };

    window.aironeAPI?.onSensorData?.(handleSensorData);
    window.aironeAPI?.onCommandSent?.(handleCommandSent);
    window.aironeAPI?.onConnectionChange?.(handleConnectionChange);

    return () => {
      window.aironeAPI?.removeAllListeners?.('brain:sensorData');
      window.aironeAPI?.removeAllListeners?.('brain:commandSent');
      window.aironeAPI?.removeAllListeners?.('brain:connectionChange');
    };
  }, [selectedRobot]);

  const refreshStatus = async () => {
    try {
      const status = await window.aironeAPI.getBrainServerStatus();
      setServerStatus(status);
      
      // Auto-select first connected robot
      if (status.connectedRobots?.length > 0 && !selectedRobot) {
        setSelectedRobot(status.connectedRobots[0]);
      }
    } catch (e) {
      // API not available
    }
  };

  const loadLogs = async () => {
    if (!selectedRobot) return;
    try {
      const logs = await window.aironeAPI.getCommandLogs(selectedRobot, 50);
      setCommandLog(logs || []);
    } catch (e) {
      console.error('Failed to load logs:', e);
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

  const handleRestartServer = async () => {
    try {
      await window.aironeAPI.stopBrainServer();
      await window.aironeAPI.startBrainServer(serverStatus.port || 8080, '0.0.0.0');
      refreshStatus();
    } catch (e) {
      console.error('Restart failed:', e);
    }
  };

  const formatSensorData = (data) => {
    if (!data) return null;
    const sensors = data.input_sensors_read || {};
    return Object.entries(sensors).map(([key, value]) => ({ key, value }));
  };

  const sensorEntries = formatSensorData(sensorData);

  return (
    <div className="live-monitor fade-in">
      <div className="page-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
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
            <span className={`status-dot ${serverStatus.running ? 'online pulse' : 'offline'}`} />
            <span className={`status-text ${serverStatus.running ? 'online' : 'offline'}`}>
              {serverStatus.running ? 'ONLINE' : 'OFFLINE'}
            </span>
            {serverStatus.running && (
              <span className="status-detail">ws://0.0.0.0:{serverStatus.port}</span>
            )}
          </div>

          {serverStatus.connectedRobots?.length > 0 && (
            <div className="connected-robots">
              <div className="form-label">Connected Robots</div>
              {serverStatus.connectedRobots.map((robotId) => (
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

          {!serverStatus.running && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={handleRestartServer}>
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
              <button
                className="btn btn-danger-large"
                onClick={handleEmergencyStop}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
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

          {sensorEntries && sensorEntries.length > 0 ? (
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
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <p>No sensor data received yet.</p>
              <p className="no-data-hint">Connect a robot to start seeing live data.</p>
            </div>
          )}

          {sensorData && (
            <div style={{ marginTop: 16 }}>
              <div className="form-label">Raw Data</div>
              <div className="code-block">
                {JSON.stringify(sensorData, null, 2)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Command Log */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Command History</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {selectedRobot && (
              <button className="btn btn-secondary btn-small" onClick={loadLogs}>
                Refresh
              </button>
            )}
          </div>
        </div>

        {/* Real-time log entries */}
        {logs.length > 0 && (
          <div className="realtime-log">
            <div className="form-label">Real-Time Events</div>
            <div className="log-entries">
              {logs.map((entry) => (
                <div key={entry.id} className={`log-entry log-${entry.direction}`}>
                  <span className="log-time">{entry.timestamp}</span>
                  <span className={`log-direction chip ${entry.direction === 'sent' ? 'chip-cyan' : entry.direction === 'system' ? 'chip-green' : 'chip-purple'}`}>
                    {entry.direction}
                  </span>
                  {entry.commands && (
                    <span className="log-content">
                      {JSON.stringify(entry.commands).substring(0, 120)}
                      {JSON.stringify(entry.commands).length > 120 ? '...' : ''}
                    </span>
                  )}
                  {entry.message && (
                    <span className="log-content">{entry.message}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Historical logs from DB */}
        {commandLog.length > 0 ? (
          <div style={{ marginTop: logs.length > 0 ? 16 : 0 }}>
            {logs.length > 0 && <div className="form-label">Database History</div>}
            <div className="log-entries">
              {commandLog.map((log, index) => (
                <div key={log.id || index} className={`log-entry log-${log.direction}`}>
                  <span className="log-time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
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
        ) : (
          !logs.length && (
            <div className="alert alert-info">
              No commands logged yet. Connect a robot and send sensor data to see command history.
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default LiveMonitor;
