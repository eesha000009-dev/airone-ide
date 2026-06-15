// ============================================================
// GENERATED AIRONE FIRMWARE - COMMAND EXECUTOR
// Target: ESP32
// DO NOT EDIT MANUALLY - Regenerate from .airo source
// ============================================================
#ifndef COMMAND_EXECUTOR_H
#define COMMAND_EXECUTOR_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "pin_map.h"

// === COMMAND EXECUTOR (from actfor block) ===
// SAFETY SANDBOX: Only these modules can be controlled by brain
// Any command for a module not listed here is silently ignored.

void execute_brain_command(const char* module, JsonObject command) {
    if (strcmp(module, "ledpin") == 0) {
        // ledpin mapped to GPIO2
        if (command.containsKey("value")) {
            int val = command["value"];
            if (val >= 0 && val <= 1) {
                digitalWrite(PIN_LEDPIN, val);
            }
        }
        if (command.containsKey("angle")) {
            int angle = command["angle"];
            if (angle >= 0 && angle <= 180) {
                servo_ledpin.write(angle);
            }
        }
        if (command.containsKey("speed")) {
            int speed = command["speed"];
            if (speed >= 0 && speed <= 255) {
                analogWrite(PIN_LEDPIN, speed);
            }
        }
        return;
    }
    // urhands has no pin mapping - brain commands for this alias handled by alias resolution
    if (strcmp(module, "urhands") == 0) {
        // Alias output - no direct pin control
        // Commands forwarded to brain for AI interpretation
        return;
    }
    // llleg has no pin mapping - brain commands for this alias handled by alias resolution
    if (strcmp(module, "llleg") == 0) {
        // Alias output - no direct pin control
        // Commands forwarded to brain for AI interpretation
        return;
    }

    // Unknown or unauthorized module - IGNORED (sandbox protection)
    Serial.print("[SANDBOX] Rejected command for: ");
    Serial.println(module);
}

#endif // COMMAND_EXECUTOR_H
