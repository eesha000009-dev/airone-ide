import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir, readFile, rm } from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const AIRO_COMPILER_DIR = '/home/z/my-project/airo-compiler';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: string;
  duration?: number;
}

interface PipelineTestResponse {
  timestamp: string;
  tests: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

async function runTest(
  name: string,
  fn: () => Promise<Omit<TestResult, 'name' | 'duration'>>
): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      name,
      ...result,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      status: 'fail',
      message: err instanceof Error ? err.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

async function checkSerialportAvailability(): Promise<{
  available: boolean;
  error?: string;
}> {
  try {
    const serialport = await import(/* webpackIgnore: true */ 'serialport').catch(() => null) as Record<string, unknown> | null;
    if (serialport && serialport.SerialPort) {
      const SerialPort = serialport.SerialPort as { list: () => Promise<unknown[]> };
      if (typeof SerialPort.list === 'function') {
        return { available: true };
      }
    }
    return { available: false, error: 'SerialPort.list not available' };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : 'Module not found' };
  }
}

export async function GET() {
  const tests: TestResult[] = [];

  // ── Test 1: Python availability ──────────────────────────────
  tests.push(
    await runTest('Python3 Availability', async () => {
      try {
        const { stdout } = await execFileAsync('python3', ['--version'], {
          timeout: 5000,
        });
        return {
          status: 'pass',
          message: `Python3 available: ${stdout.trim()}`,
        };
      } catch {
        return {
          status: 'fail',
          message: 'Python3 is not available or not in PATH',
          details: 'Install Python 3: https://www.python.org/downloads/',
        };
      }
    })
  );

  // ── Test 2: airo-compiler import ─────────────────────────────
  tests.push(
    await runTest('Airo Compiler Import', async () => {
      try {
        const { stdout, stderr } = await execFileAsync(
          'python3',
          ['-c', 'import airo_compiler; print(f"Version: {airo_compiler.__version__}")'],
          {
            timeout: 10000,
            env: {
              ...process.env,
              PYTHONPATH: AIRO_COMPILER_DIR,
            },
          }
        );

        if (stdout.trim()) {
          return {
            status: 'pass',
            message: `airo_compiler imported successfully: ${stdout.trim()}`,
          };
        }

        return {
          status: 'fail',
          message: 'airo_compiler import produced no output',
          details: stderr || undefined,
        };
      } catch (err) {
        const execErr = err as { stderr?: string };
        return {
          status: 'fail',
          message: 'Failed to import airo_compiler',
          details: execErr.stderr || (err instanceof Error ? err.message : undefined),
        };
      }
    })
  );

  // ── Test 3: Jinja2 availability ──────────────────────────────
  tests.push(
    await runTest('Jinja2 Availability', async () => {
      try {
        const { stdout } = await execFileAsync(
          'python3',
          ['-c', 'import jinja2; print(f"Jinja2 version: {jinja2.__version__}")'],
          {
            timeout: 5000,
            env: {
              ...process.env,
              PYTHONPATH: AIRO_COMPILER_DIR,
            },
          }
        );

        return {
          status: 'pass',
          message: `Jinja2 available: ${stdout.trim()}`,
        };
      } catch (err) {
        const execErr = err as { stderr?: string };
        return {
          status: 'fail',
          message: 'Jinja2 is not installed',
          details:
            'Install with: pip install Jinja2\n' +
            (execErr.stderr || (err instanceof Error ? err.message : '')),
        };
      }
    })
  );

  // ── Test 4: esptool detection ────────────────────────────────
  tests.push(
    await runTest('esptool Detection', async () => {
      const attempts = [
        { cmd: 'which', args: ['esptool.py'] },
        { cmd: 'which', args: ['esptool'] },
        { cmd: 'python3', args: ['-m', 'esptool', '--version'] },
      ];

      for (const { cmd, args } of attempts) {
        try {
          const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
          if (stdout.trim()) {
            return {
              status: 'pass',
              message: `esptool found: ${cmd} ${args.join(' ')} → ${stdout.trim()}`,
            };
          }
        } catch {
          // Try next method
        }
      }

      return {
        status: 'warn',
        message: 'esptool not found',
        details: 'Install with: pip install esptool\nChecked: which esptool.py, which esptool, python3 -m esptool',
      };
    })
  );

  // ── Test 5: serialport npm availability ──────────────────────
  tests.push(
    await runTest('serialport npm Package', async () => {
      const result = await checkSerialportAvailability();

      if (result.available) {
        return {
          status: 'pass',
          message: 'serialport npm package is available',
        };
      }

      return {
        status: 'warn',
        message: 'serialport npm package is not installed',
        details:
          'Install with: npm install serialport\n' +
          'Note: serialport requires native compilation and may not work in all environments.\n' +
          (result.error || ''),
      };
    })
  );

  // ── Test 6: Full compile pipeline ────────────────────────────
  tests.push(
    await runTest('Full Compile Pipeline', async () => {
      let tempDir: string | null = null;

      try {
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'airo-pipeline-test-'));
        const sourceFile = path.join(tempDir, 'test.airo');
        const outputDir = path.join(tempDir, 'output');

        // Write a sample .airo file
        const sampleCode = `#library#
Pin defi {
    ledpin = 2; output.
}

#variables#
brain_url = "wss://test.local:8080".
call brain_url.

loop {
    read_for(1000) {
    }
    senddatato(brain_url).
    actfor(1000) {
        ledpin.
    }
}`;

        await writeFile(sourceFile, sampleCode, 'utf-8');
        await mkdir(outputDir, { recursive: true });

        // Run the compiler
        const { stdout, stderr } = await execFileAsync(
          'python3',
          ['-m', 'airo_compiler', sourceFile, '--target', 'esp32', '--output', outputDir],
          {
            cwd: AIRO_COMPILER_DIR,
            env: {
              ...process.env,
              PYTHONPATH: AIRO_COMPILER_DIR,
            },
            timeout: 30000,
          }
        );

        // Check output files
        const expectedFiles = [
          'main.cpp',
          'pin_map.h',
          'sensor_reader.h',
          'command_executor.h',
          'safety_monitor.h',
          'brain_client.h',
        ];

        const foundFiles: string[] = [];
        const missingFiles: string[] = [];

        for (const filename of expectedFiles) {
          try {
            const filePath = path.join(outputDir, filename);
            const content = await readFile(filePath, 'utf-8');
            if (content.length > 0) {
              foundFiles.push(filename);
            } else {
              missingFiles.push(`${filename} (empty)`);
            }
          } catch {
            missingFiles.push(filename);
          }
        }

        // Clean up
        try {
          if (tempDir) await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }

        if (foundFiles.length === expectedFiles.length) {
          return {
            status: 'pass',
            message: `Full pipeline successful. All ${foundFiles.length} files generated`,
            details:
              `Compiler output:\n${stdout}\n` +
              (stderr ? `Warnings:\n${stderr}\n` : '') +
              `Generated files: ${foundFiles.join(', ')}`,
          };
        } else {
          return {
            status: 'warn',
            message: `Pipeline partially successful. ${foundFiles.length}/${expectedFiles.length} files generated`,
            details:
              `Found: ${foundFiles.join(', ')}\n` +
              `Missing: ${missingFiles.join(', ')}\n` +
              `Output: ${stdout}\n` +
              (stderr ? `Stderr: ${stderr}` : ''),
          };
        }
      } catch (err) {
        // Clean up on error
        try {
          if (tempDir) await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }

        return {
          status: 'fail',
          message: 'Full pipeline compilation failed',
          details: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    })
  );

  // ── Build summary ────────────────────────────────────────────
  const summary = {
    total: tests.length,
    passed: tests.filter((t) => t.status === 'pass').length,
    failed: tests.filter((t) => t.status === 'fail').length,
    warnings: tests.filter((t) => t.status === 'warn').length,
  };

  const response: PipelineTestResponse = {
    timestamp: new Date().toISOString(),
    tests,
    summary,
  };

  return NextResponse.json(response);
}
