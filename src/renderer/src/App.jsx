/**
 * Airone AI Backbone - Main App Component
 * Desktop application layout with sidebar navigation, topbar, and page routing.
 * Manages brain server status polling and connection change events.
 */

import React, { useState, useEffect, useCallback, Fragment } from 'react';
import RobotIdentity from './components/RobotIdentity';
import AiModel from './components/AiModel';
import AiChat from './components/AiChat';
import HardwareMap from './components/HardwareMap';
import LiveMonitor from './components/LiveMonitor';

// SVG Icon Components
const Icons = {
  Robot: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
      <circle cx="8" cy="16" r="1" />
      <circle cx="16" cy="16" r="1" />
    </svg>
  ),
  Brain: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a5 5 0 0 1 5 5c0 .91-.244 1.765-.67 2.5H17a4 4 0 0 1 0 8h-1.05A5.001 5.001 0 0 1 7 19a5.001 5.001 0 0 1-1.95-9.5A5 5 0 0 1 12 2z" />
      <line x1="12" y1="10" x2="12" y2="22" />
      <line x1="8" y1="14" x2="16" y2="14" />
    </svg>
  ),
  Chat: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Hardware: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  ),
  Monitor: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Logo: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  )
};

// Sidebar navigation items - reorganized by sections
const navItems = [
  { id: 'identity', label: 'Robot Identity', icon: Icons.Robot, section: 'Configuration' },
  { id: 'ai-chat', label: 'AI Chat', icon: Icons.Chat, section: 'AI' },
  { id: 'ai-model', label: 'AI Model', icon: Icons.Brain, section: 'AI' },
  { id: 'hardware', label: 'Hardware Map', icon: Icons.Hardware, section: 'Hardware' },
  { id: 'monitor', label: 'Live Monitor', icon: Icons.Monitor, section: 'Monitoring' }
];

function App() {
  const [activePage, setActivePage] = useState('identity');
  const [brainStatus, setBrainStatus] = useState({ running: false, port: 8080 });
  const [connectedRobots, setConnectedRobots] = useState([]);

  // Poll brain server status every 3 seconds
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

  // Listen for robot connection changes
  useEffect(() => {
    window.aironeAPI?.onConnectionChange?.((event) => {
      if (event.data?.type === 'client:connected' || event.data?.type === 'client:disconnected') {
        window.aironeAPI.getBrainServerStatus()
          .then((status) => {
            setBrainStatus(status);
            setConnectedRobots(status.connectedRobots || []);
          })
          .catch(() => {});
      }
    });
    return () => {
      window.aironeAPI?.removeAllListeners?.('brain:connectionChange');
    };
  }, []);

  // Render the active page
  const renderPage = useCallback(() => {
    switch (activePage) {
      case 'identity':
      default:
        return <RobotIdentity />;
      case 'ai-chat':
        return <AiChat />;
      case 'ai-model':
        return <AiModel />;
      case 'hardware':
        return <HardwareMap />;
      case 'monitor':
        return <LiveMonitor />;
    }
  }, [activePage]);

  let lastSection = '';

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">A</div>
          <div className="sidebar-brand">
            Air<span>one</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const showSection = item.section !== lastSection;
            lastSection = item.section;
            return (
              <Fragment key={item.id}>
                {showSection && (
                  <div className="sidebar-section-label">{item.section}</div>
                )}
                <div
                  className={`sidebar-item ${activePage === item.id ? 'active' : ''}`}
                  onClick={() => setActivePage(item.id)}
                >
                  <item.icon />
                  {item.label}
                </div>
              </Fragment>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className={`status-dot ${brainStatus.running ? 'online' : 'offline'}`} />
            <span>Brain Server: {brainStatus.running ? `Port ${brainStatus.port}` : 'Stopped'}</span>
          </div>
          {connectedRobots.length > 0 && (
            <div style={{ color: 'var(--green)', marginTop: 4 }}>
              {connectedRobots.length} robot(s) connected
            </div>
          )}
        </div>
      </aside>

      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-title">
          {React.createElement(navItems.find(n => n.id === activePage)?.icon || Icons.Robot)}
          {navItems.find(n => n.id === activePage)?.label || 'Airone'}
        </div>
        <div className="topbar-status">
          <span className={`status-dot ${brainStatus.running ? 'online pulse' : 'offline'}`} />
          <span style={{ color: brainStatus.running ? 'var(--green)' : 'var(--red)' }}>
            {brainStatus.running ? 'ONLINE' : 'OFFLINE'}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>|</span>
          <span style={{ color: 'var(--text-muted)' }}>v0.1.0</span>
        </div>
      </div>

      {/* Main Content */}
      <main className="main-content fade-in" key={activePage}>
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
