'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'running';
  message: string;
  details?: string;
  duration?: number;
}

interface PipelineSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
}

export function PipelineTestPanel() {
  const [tests, setTests] = useState<TestResult[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const runTests = useCallback(async () => {
    setLoading(true);
    setTests([]);
    setSummary(null);

    try {
      const response = await fetch('/api/test-pipeline');
      if (!response.ok) {
        setTests([
          {
            name: 'Pipeline Test',
            status: 'fail',
            message: `HTTP ${response.status}: Failed to connect to test endpoint`,
          },
        ]);
        setLoading(false);
        return;
      }

      const data = await response.json();
      setTests(data.tests || []);
      setSummary(data.summary || null);
      setLastRun(data.timestamp || new Date().toISOString());
    } catch (err) {
      setTests([
        {
          name: 'Pipeline Test',
          status: 'fail',
          message: `Network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  const statusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="size-3.5 text-green-400" />;
      case 'fail':
        return <XCircle className="size-3.5 text-red-400" />;
      case 'warn':
        return <AlertTriangle className="size-3.5 text-yellow-400" />;
      case 'running':
        return <Loader2 className="size-3.5 animate-spin text-blue-400" />;
    }
  };

  const statusBg = (status: TestResult['status']) => {
    switch (status) {
      case 'pass':
        return 'bg-green-500/5 border-green-500/20';
      case 'fail':
        return 'bg-red-500/5 border-red-500/20';
      case 'warn':
        return 'bg-yellow-500/5 border-yellow-500/20';
      case 'running':
        return 'bg-blue-500/5 border-blue-500/20';
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pipeline Diagnostics — Compiler · Port · Upload
        </span>
        <div className="flex items-center gap-2">
          {lastRun && (
            <span className="text-[10px] text-muted-foreground/50">
              Last: {new Date(lastRun).toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={runTests}
            disabled={loading}
            className="h-6 gap-1 px-2 text-[10px] text-[#4ec9b0] hover:text-[#4ec9b0] hover:bg-[#2d2d2d]"
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {tests.length > 0 ? 'Re-run' : 'Run Tests'}
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      {summary && (
        <div className="flex items-center gap-4 border-b border-border bg-[#252526] px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {summary.total} tests
          </span>
          {summary.passed > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <CheckCircle2 className="size-3" /> {summary.passed} passed
            </span>
          )}
          {summary.failed > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-red-400">
              <XCircle className="size-3" /> {summary.failed} failed
            </span>
          )}
          {summary.warnings > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400">
              <AlertTriangle className="size-3" /> {summary.warnings} warnings
            </span>
          )}
        </div>
      )}

      {/* Test results */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5">
          {tests.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground/50">
              <Play className="size-8" />
              <p className="text-xs">Click &quot;Run Tests&quot; to test the compiler, port detection, and upload pipeline</p>
              <p className="text-[10px] text-muted-foreground/30">
                Tests: Python availability · airo-compiler · Jinja2 · esptool · serialport · Full compile pipeline
              </p>
            </div>
          )}

          {tests.map((test, i) => (
            <div
              key={i}
              className={`rounded border px-3 py-2 ${statusBg(test.status)}`}
            >
              <div className="flex items-center gap-2">
                {statusIcon(test.status)}
                <span className="text-xs font-medium text-white/90">
                  {test.name}
                </span>
                {test.duration !== undefined && (
                  <span className="ml-auto text-[10px] text-muted-foreground/40">
                    {test.duration}ms
                  </span>
                )}
              </div>
              <p className="mt-0.5 pl-5.5 text-[11px] text-muted-foreground/70">
                {test.message}
              </p>
              {test.details && (
                <pre className="mt-1.5 ml-5.5 whitespace-pre-wrap rounded bg-black/20 px-2 py-1 font-mono text-[10px] text-muted-foreground/50 max-h-32 overflow-y-auto">
                  {test.details}
                </pre>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
