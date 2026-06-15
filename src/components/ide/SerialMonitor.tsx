'use client';

import { useRef, useEffect, useState } from 'react';
import { useIDEStore } from '@/stores/ide-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Wifi,
  WifiOff,
  Send,
  Trash2,
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react';

export function SerialMonitor() {
  const {
    serialStatus,
    serialMessages,
    serialPort,
    serialBaudRate,
    connectSerial,
    disconnectSerial,
    sendSerialData,
    clearSerial,
  } = useIDEStore();

  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [serialMessages]);

  const handleSend = () => {
    if (input.trim()) {
      sendSerialData(input);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  const isConnected = serialStatus === 'connected';

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Serial Monitor
          </span>
          {serialStatus === 'connecting' && (
            <Loader2 className="size-3 animate-spin text-yellow-400" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/50">
            {serialBaudRate} baud
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSerial}
            className="h-5 px-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="p-3 font-mono text-xs leading-relaxed">
          {serialMessages.length === 0 && (
            <div className="text-muted-foreground/40">
              {isConnected
                ? 'Waiting for serial data...'
                : 'Connect to start monitoring serial output'}
            </div>
          )}
          {serialMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${
                msg.direction === 'tx' ? 'text-[#569cd6]' : 'text-[#9cdcfe]'
              }`}
            >
              <span className="shrink-0 text-muted-foreground/40">
                {msg.direction === 'rx' ? (
                  <ArrowDownToLine className="inline size-3" />
                ) : (
                  <ArrowUpFromLine className="inline size-3" />
                )}
              </span>
              <span className="shrink-0 text-muted-foreground/40">
                {new Date(msg.timestamp).toLocaleTimeString('en-US', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span className="whitespace-pre-wrap">{msg.data}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input + Connect */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button
          variant={isConnected ? 'destructive' : 'default'}
          size="sm"
          onClick={isConnected ? disconnectSerial : connectSerial}
          className="h-7 gap-1.5 text-xs"
        >
          {isConnected ? (
            <>
              <WifiOff className="size-3.5" />
              Disconnect
            </>
          ) : (
            <>
              <Wifi className="size-3.5" />
              Connect
            </>
          )}
        </Button>

        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? 'Send data...' : 'Connect first'}
          disabled={!isConnected}
          className="h-7 flex-1 border-border bg-[#2d2d2d] text-xs font-mono"
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSend}
          disabled={!isConnected || !input.trim()}
          className="h-7 px-2"
        >
          <Send className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
