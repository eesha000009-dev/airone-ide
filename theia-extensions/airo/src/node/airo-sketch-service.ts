/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import {
    AiroSketchClient,
    SketchInfo,
    ExampleSketch,
    BoardInfo,
    VerifyResult,
    SyntaxError
} from '../common/airo-protocol';
import { AiroCompilerService } from './airo-compiler-service';

/** Convert a file:// URI to a filesystem path */
function fsPathFromUri(uri: string): string {
    const parsed = new URL(uri);
    let filePath = decodeURIComponent(parsed.pathname);
    // Windows: remove leading slash from /C:/...
    if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:/)) {
        filePath = filePath.substring(1);
    }
    return filePath;
}

@injectable()
export class AiroSketchService implements AiroSketchClient {

    @inject(WorkspaceServer)
    protected readonly workspaceServer!: WorkspaceServer;

    @inject(AiroCompilerService)
    protected readonly compilerService!: AiroCompilerService;

    private readonly boards: BoardInfo[] = [
        { id: 'esp32-devkit', name: 'ESP32 DevKit', fqbn: 'esp32:esp32:esp32', platform: 'esp32' },
        { id: 'esp32-s2', name: 'ESP32-S2', fqbn: 'esp32:esp32:esp32s2', platform: 'esp32' },
        { id: 'esp32-s3', name: 'ESP32-S3', fqbn: 'esp32:esp32:esp32s3', platform: 'esp32' },
        { id: 'esp32-c3', name: 'ESP32-C3', fqbn: 'esp32:esp32:esp32c3', platform: 'esp32' },
        { id: 'esp8266', name: 'ESP8266', fqbn: 'esp8266:esp8266:generic', platform: 'esp8266' },
    ];

    async newSketch(name: string): Promise<SketchInfo> {
        const workspace = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        let root: string;
        if (workspace) {
            root = fsPathFromUri(workspace);
        } else {
            // No workspace open — use a user-writable directory
            const homeDir = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || process.cwd();
            const sketchesDir = path.join(homeDir, 'AironeProjects');
            if (!fs.existsSync(sketchesDir)) {
                fs.mkdirSync(sketchesDir, { recursive: true });
            }
            root = sketchesDir;
        }

        const sketchDir = path.join(root, name);
        const mainFile = path.join(sketchDir, `${name}.airo`);

        if (!fs.existsSync(sketchDir)) {
            fs.mkdirSync(sketchDir, { recursive: true });
        }

        // Only write template if the file doesn't already exist
        if (!fs.existsSync(mainFile)) {
            const template = await this.compilerService.getTemplate();
            fs.writeFileSync(mainFile, template, { encoding: 'utf8' });
        }

        return {
            name,
            path: sketchDir,
            mainFile
        };
    }

    async newSketchFromExample(name: string, code: string): Promise<SketchInfo> {
        const workspace = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        let root: string;
        if (workspace) {
            root = fsPathFromUri(workspace);
        } else {
            const homeDir = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || process.cwd();
            const sketchesDir = path.join(homeDir, 'AironeProjects');
            if (!fs.existsSync(sketchesDir)) {
                fs.mkdirSync(sketchesDir, { recursive: true });
            }
            root = sketchesDir;
        }

        const sketchDir = path.join(root, name);
        const mainFile = path.join(sketchDir, `${name}.airo`);

        if (!fs.existsSync(sketchDir)) {
            fs.mkdirSync(sketchDir, { recursive: true });
        }

        if (!fs.existsSync(mainFile)) {
            fs.writeFileSync(mainFile, code, { encoding: 'utf8' });
        }

        return {
            name,
            path: sketchDir,
            mainFile
        };
    }

    async listExamples(): Promise<ExampleSketch[]> {
        return [
            {
                name: 'Blink',
                category: '01.Basics',
                description: 'Turn an LED on and off periodically',
                code: this.getBlinkExample()
            },
            {
                name: 'ReadSensor',
                category: '01.Basics',
                description: 'Read a sensor value and print to serial',
                code: this.getReadSensorExample()
            },
            {
                name: 'WiFiConnect',
                category: '02.Network',
                description: 'Connect to WiFi and send data',
                code: this.getWiFiExample()
            },
            {
                name: 'ServoControl',
                category: '03.Actuators',
                description: 'Control a servo motor',
                code: this.getServoExample()
            },
            {
                name: 'RobotBasic',
                category: '04.Robotics',
                description: 'Basic robot sense-think-act loop',
                code: this.getRobotBasicExample()
            },
            {
                name: 'UltrasonicRange',
                category: '05.Sensors',
                description: 'Measure distance with ultrasonic sensor',
                code: this.getUltrasonicExample()
            }
        ];
    }

    async loadExample(name: string): Promise<string> {
        const examples = await this.listExamples();
        const example = examples.find(e => e.name === name);
        if (!example) {
            throw new Error(`Example "${name}" not found`);
        }
        return example.code;
    }

    /**
     * Verify a .airo file using the built-in TypeScript compiler first,
     * then try Python-based full compilation if available.
     */
    async verify(filePath: string): Promise<VerifyResult> {
        const fsPath = filePath.startsWith('file://') ? fsPathFromUri(filePath) : filePath;

        if (!fs.existsSync(fsPath)) {
            return {
                success: false,
                output: '',
                error: `File not found: ${fsPath}`,
                errors: [{ line: 0, column: 0, message: `File not found: ${fsPath}`, severity: 'error' }]
            };
        }

        try {
            // Use the built-in compiler for fast, dependency-free verification
            const result = await this.compilerService.verifyBuiltIn(fsPath);

            // If built-in check fails, return immediately
            if (!result.success) {
                return result;
            }

            // Built-in check passed — try full Python compilation if available
            const compileResult = await this.compilerService.compile({
                filePath: fsPath,
                target: 'esp32',
                outputDir: path.join(path.dirname(fsPath), 'build')
            });

            if (compileResult.success) {
                return {
                    success: true,
                    output: result.output + '\n' + (compileResult.output || ''),
                };
            }

            // Python compilation failed but built-in check passed
            // This could mean the syntax is OK but compilation has issues
            const errors: SyntaxError[] = [];
            if (compileResult.error) {
                const parsedErrors = this.parseCompilerErrors(compileResult.error);
                errors.push(...parsedErrors);
            }

            // If Python gave specific errors, use those
            if (errors.length > 0) {
                return {
                    success: false,
                    output: compileResult.output || result.output,
                    error: compileResult.error,
                    errors
                };
            }

            // Otherwise return the built-in result (Python may just not be installed)
            return result;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                output: '',
                error: message,
                errors: [{ line: 0, column: 0, message, severity: 'error' }]
            };
        }
    }

    async getBoards(): Promise<BoardInfo[]> {
        return this.boards;
    }

    async getDefaultBoard(): Promise<BoardInfo> {
        return this.boards[0];
    }

    private parseCompilerErrors(stderr: string): SyntaxError[] {
        const errors: SyntaxError[] = [];
        const lines = stderr.split('\n');
        const errorPattern = /^.+:(\d+):(\d+):\s*(error|warning):\s*(.+)$/;

        for (const line of lines) {
            const match = line.match(errorPattern);
            if (match) {
                errors.push({
                    line: parseInt(match[1], 10),
                    column: parseInt(match[2], 10),
                    message: match[4],
                    severity: match[3] as 'error' | 'warning'
                });
            }
        }

        if (errors.length === 0 && stderr.trim()) {
            errors.push({
                line: 0,
                column: 0,
                message: stderr.trim(),
                severity: 'error'
            });
        }

        return errors;
    }

    // ─── Example Sketch Templates ─────────────────────────────────────────

    private getBlinkExample(): string {
        return `# ============================================
# BLINK — Turn an LED on and off
# ============================================

#library#
# No extra libraries needed for basic blink

Pin defi {
    led = 2; output.
}

#variables#
blink_delay = 1000.

loop {
    read_for(0) {
    }

    led = HIGH.
    call blink_delay.
    led = LOW.
    call blink_delay.
}
`;
    }

    private getReadSensorExample(): string {
        return `# ============================================
# READ SENSOR — Read analog sensor value
# ============================================

#library#
# call body/sight/eyes.airo.

Pin defi {
    sensor_pin = 34; input.
    led = 2; output.
}

#variables#
threshold = 2000.

loop {
    read_for(500) {
        sensor_pin.
    }

    ask sensor_pin > threshold {
        led = HIGH.
    } else {
        led = LOW.
    }
}
`;
    }

    private getWiFiExample(): string {
        return `# ============================================
# WIFI CONNECT — Connect to WiFi
# ============================================

#library#
# call body/comm/wifi.airo.

Pin defi {
    status_led = 2; output.
}

#variables#
wifi_ssid = "YourNetwork".
wifi_password = "YourPassword".
server_url = "http://example.com/data".

loop {
    read_for(2000) {
        # sense data from sensors
    }

    senddatato(server_url).

    actfor(100) {
        status_led.
    }
}
`;
    }

    private getServoExample(): string {
        return `# ============================================
# SERVO CONTROL — Control a servo motor
# ============================================

#library#
# call body/actuation/servo.airo.

Pin defi {
    servo_pin = 13; output.
    pot_pin = 34; input.
}

#variables#
min_angle = 0.
max_angle = 180.

loop {
    read_for(100) {
        pot_pin.
    }

    # Map pot value to servo angle
    saveto servo_pin = pot_pin.

    actfor(50) {
        servo_pin.
    }
}
`;
    }

    private getRobotBasicExample(): string {
        return `# ============================================
# ROBOT BASIC — Sense → Think → Act
# ============================================

#library#
# call body/actuation/upper-right-hands.airo.
# call body/sight/eyes.airo.
# call body/hearing/ears.airo.

Pin defi {
    led = 2; output.
    motor_left = 13; output.
    motor_right = 12; output.
    ultrasonic = 34; input.
}

#variables#
brain_url = "wss://your-brain.local:8080".
call brain_url.

# body/sight/eyes.airo = eyes.
# body/hearing/ears.airo = ears.

loop {
    read_for(1000) {
        # eyes.
        # ears.
        ultrasonic.
    }

    senddatato(brain_url).

    actfor(1000) {
        led.
        motor_left.
        motor_right.
    }
}
`;
    }

    private getUltrasonicExample(): string {
        return `# ============================================
# ULTRASONIC RANGE — Measure distance
# ============================================

#library#
# call body/other_sensors/ultrasonic.airo.

Pin defi {
    trig = 25; output.
    echo = 34; input.
    led = 2; output.
}

#variables#
safe_distance = 20.

loop {
    read_for(200) {
        echo.
    }

    ask echo < safe_distance {
        led = HIGH.
    } else {
        led = LOW.
    }

    actfor(50) {
        trig.
        led.
    }
}
`;
    }
}
