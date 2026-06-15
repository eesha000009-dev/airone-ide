'use client';

import { useRef, useEffect, useState } from 'react';
import { useIDEStore } from '@/stores/ide-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, Bot, User, Sparkles } from 'lucide-react';

export function AIAssistantPanel() {
  const {
    chatMessages,
    chatInput,
    chatLoading,
    setChatInput,
    sendChatMessage,
  } = useIDEStore();

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = () => {
    if (chatInput.trim() && !chatLoading) {
      sendChatMessage(chatInput);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Sparkles className="size-4 text-[#4ec9b0]" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          AI Assistant
        </span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-4">
          {chatMessages.map((msg) => {
            if (msg.role === 'system') {
              return (
                <div
                  key={msg.id}
                  className="rounded-lg border border-[#4ec9b0]/20 bg-[#4ec9b0]/5 p-3 text-xs text-[#4ec9b0]"
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#4ec9b0]/60">
                    <Sparkles className="size-3" />
                    Airone AI
                  </div>
                  {msg.content}
                </div>
              );
            }

            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                    isUser
                      ? 'bg-[#569cd6]/20 text-[#569cd6]'
                      : 'bg-[#4ec9b0]/20 text-[#4ec9b0]'
                  }`}
                >
                  {isUser ? (
                    <User className="size-3.5" />
                  ) : (
                    <Bot className="size-3.5" />
                  )}
                </div>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-[#569cd6]/10 text-[#9cdcfe]'
                      : 'bg-[#2d2d2d] text-[#ccc]'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            );
          })}

          {chatLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Thinking...</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Quick actions */}
      <div className="flex gap-1 border-t border-border px-3 py-1.5">
        {['How do I define pins?', 'Show me a robot loop', 'Explain senddatato'].map(
          (q) => (
            <button
              key={q}
              onClick={() => {
                setChatInput(q);
                sendChatMessage(q);
              }}
              disabled={chatLoading}
              className="rounded-full border border-border bg-[#2d2d2d] px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-[#4ec9b0]/30 hover:text-[#4ec9b0] disabled:opacity-50"
            >
              {q}
            </button>
          )
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <Textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about .airo programming..."
            disabled={chatLoading}
            className="min-h-[36px] max-h-[80px] flex-1 resize-none border-border bg-[#2d2d2d] text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSend}
            disabled={chatLoading || !chatInput.trim()}
            className="h-9 w-9 shrink-0 text-[#4ec9b0] hover:text-[#4ec9b0] hover:bg-[#4ec9b0]/10"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
