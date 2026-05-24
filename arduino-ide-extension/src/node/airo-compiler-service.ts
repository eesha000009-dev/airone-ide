import { inject, injectable } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { AiroCompilerService } from '../common/protocol/airo-compiler-service';

/**
 * Resolve the path to the Airo Compiler CLI script.
 *
 * Resolution order:
 *   1. Packaged app: process.resourcesPath/airo-compiler/cli.py
 *   2. Development:  relative path from this compiled file to electron-app/resources/airo-compiler/cli.py
 */
async function resolveCompilerCliPath(): Promise<string> {
  const candidates: string[] = [];
  const labels: string[] = []; // Human-readable labels for error messages

  // 1. Packaged Electron app – resources are placed via extraResources in electron-builder config
  if (process.resourcesPath) {
    const packagedPath = path.join(process.resourcesPath, 'airo-compiler', 'cli.py');
    candidates.push(packagedPath);
    labels.push(`Packaged app path: ${packagedPath}`);
  }

  // 2. Development – this file lives inside arduino-ide-extension/lib/node/,
  //    so we walk up to the repo root and into electron-app/resources.
  const devPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'electron-app',
    'resources',
    'airo-compiler',
    'cli.py'
  );
  candidates.push(devPath);
  labels.push(`Development path: ${devPath}`);

  for (let i = 0; i < candidates.length; i++) {
    try {
      await fs.access(candidates[i]);
      return candidates[i];
    } catch {
      // not found – try the next candidate
    }
  }

  throw new Error(
    'Could not locate the Airo Compiler CLI (cli.py). Searched:\n  ' +
      labels.join('\n  ') +
      '\n\nPlease ensure:\n' +
      '  • In the packaged app: the airo-compiler is bundled as an extraResource\n' +
      '  • In development: run from the project root so relative paths resolve correctly\n' +
      '  • Python 3 must be installed and available on your system PATH'
  );
}

/**
 * Find a usable Python interpreter on the system.
 * Tries `python3` first, then falls back to `python`.
 */
async function findPythonCommand(): Promise<string> {
  const commands = ['python3', 'python'];

  for (const cmd of commands) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(cmd, ['--version'], { timeout: 5_000 }, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      return cmd;
    } catch {
      // not available – try next
    }
  }

  throw new Error(
    'Python interpreter not found. Please install Python 3 and ensure ' +
      '`python3` or `python` is available on your system PATH.'
  );
}

/**
 * Service for transpiling .airo source code to C++/Arduino code.
 * Invokes the Python-based airo compiler via CLI.
 */
@injectable()
export class AiroCompilerServiceImpl implements AiroCompilerService {
  @inject(ILogger)
  private readonly logger: ILogger;

  /** Cached paths – resolved once on first use. */
  private _cliPath: string | undefined;
  private _pythonCmd: string | undefined;

  async transpileAiro(airoCode: string): Promise<string> {
    // Resolve compiler CLI path & Python interpreter (lazy, cached)
    if (!this._cliPath) {
      this._cliPath = await resolveCompilerCliPath();
      this.logger.info(`Airo Compiler CLI resolved at: ${this._cliPath}`);
    }
    if (!this._pythonCmd) {
      this._pythonCmd = await findPythonCommand();
      this.logger.info(`Python interpreter resolved as: ${this._pythonCmd}`);
    }

    // Write the .airo source to a temporary file
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'airo-compiler-')
    );
    const airoFilePath = path.join(tempDir, 'input.airo');
    const outputDir = path.join(tempDir, 'output');

    try {
      await fs.writeFile(airoFilePath, airoCode, { encoding: 'utf8' });
      await fs.mkdir(outputDir, { recursive: true });

      // Invoke the Python airo compiler
      const result = await this.invokeCompiler(
        airoFilePath,
        outputDir,
        this._cliPath,
        this._pythonCmd
      );

      return result;
    } catch (err) {
      this.logger.error('Failed to transpile .airo code', err);
      throw new Error(
        `Airo transpilation failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // Clean up temp files
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private invokeCompiler(
    inputPath: string,
    outputDir: string,
    cliPath: string,
    pythonCmd: string
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const args = [
        cliPath,
        inputPath,
        '--target',
        'esp32',
        '--output',
        outputDir,
      ];

      execFile(
        pythonCmd,
        args,
        {
          timeout: 30_000, // 30 second timeout
          maxBuffer: 1024 * 1024, // 1MB buffer
        },
        async (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `Compiler execution failed: ${error.message}\n${stderr}`
              )
            );
            return;
          }

          // Read the generated main.cpp and convert it to .ino content
          try {
            const mainCppPath = path.join(outputDir, 'main.cpp');
            const content = await fs.readFile(mainCppPath, {
              encoding: 'utf8',
            });

            // Also read any generated .h files and combine them into a single .ino
            const headerFiles: string[] = [];
            const outputFiles = await fs.readdir(outputDir);
            for (const file of outputFiles) {
              if (file.endsWith('.h') && file !== 'main.cpp') {
                const headerPath = path.join(outputDir, file);
                const headerContent = await fs.readFile(headerPath, {
                  encoding: 'utf8',
                });
                headerFiles.push(
                  `// --- ${file} ---\n${headerContent}\n// --- end ${file} ---\n`
                );
              }
            }

            // Combine headers + main code into a single .ino file
            const combined = headerFiles.length > 0
              ? `${headerFiles.join('\n')}\n${content}`
              : content;

            resolve(combined);
          } catch (readErr) {
            // If we can't read the output, fall back to stdout
            if (stdout) {
              resolve(stdout);
            } else {
              reject(
                new Error(
                  `Failed to read compiler output: ${readErr instanceof Error ? readErr.message : String(readErr)}\nstderr: ${stderr}`
                )
              );
            }
          }
        }
      );
    });
  }
}
