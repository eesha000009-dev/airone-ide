// ============================================================
// GENERATED AIRONE FIRMWARE - SAFETY MONITOR
// Target: ESP32
// HARD SAFETY: These checks are UNMODIFIABLE by the brain.
// DO NOT EDIT MANUALLY - Regenerate from .airo source
// ============================================================
#ifndef SAFETY_MONITOR_H
#define SAFETY_MONITOR_H

#include <Arduino.h>
#include "sensor_reader.h"
#include "pin_map.h"

// === SAFETY THRESHOLDS (compiled-in, cannot be overridden) ===
const float SAFETY_TEMP_MAX = 60.0;   // Celsius
const float SAFETY_ULTRASONIC_MIN = 20.0; // cm
const unsigned long SAFETY_BRAIN_TIMEOUT = 30000; // ms
const unsigned long SAFETY_WATCHDOG_TIMEOUT = 5000; // ms

// === STATE TRACKING ===
unsigned long last_brain_contact = 0;
unsigned long last_loop_time = 0;
bool safe_mode_active = false;

// Emergency stop: kills all outputs immediately
void emergency_stop() {
    if (!safe_mode_active) {
        Serial.println("[SAFETY] EMERGENCY STOP ACTIVATED!");
        safe_mode_active = true;
    }
    digitalWrite(PIN_LEDPIN, LOW);  // Kill ledpin
}

// === HARD SAFETY CHECKS (run every loop iteration) ===
void run_safety_checks() {
    // Thermal protection: temperature > 60.0°C
    if (current_data.temperature > 60.0) {
        Serial.println("[SAFETY] Thermal protection: temperature > 60.0°C");
        emergency_stop();
        return;
    }
    // Proximity alert: eyes < 20.0cm
    if (current_data.eyes < 20.0) {
        Serial.println("[SAFETY] Proximity alert: eyes < 20.0cm");
        emergency_stop();
        return;
    }

    // Watchdog: detect loop freeze
    unsigned long now = millis();
    if (last_loop_time > 0 && (now - last_loop_time) > SAFETY_WATCHDOG_TIMEOUT) {
        Serial.println("[SAFETY] Watchdog timeout - loop frozen!");
        emergency_stop();
    }
    last_loop_time = now;

    // Brain timeout: safe mode after prolonged disconnect
    if (brain_connected && last_brain_contact == 0) {
        last_brain_contact = now;
    }
    if (brain_connected) {
        last_brain_contact = now;
        safe_mode_active = false;  // Clear safe mode on reconnection
    } else if (last_brain_contact > 0 && (now - last_brain_contact) > SAFETY_BRAIN_TIMEOUT) {
        Serial.println("[SAFETY] Brain timeout - entering safe mode!");
        emergency_stop();
    }
}

#endif // SAFETY_MONITOR_H
