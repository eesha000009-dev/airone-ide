// ============================================================
// GENERATED AIRONE FIRMWARE
// Target: ESP32
// Brain URL: wss://zeeb-brain.local:8080
// DO NOT EDIT MANUALLY - Regenerate from .airo source
// ============================================================

#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// Project headers
#include "pin_map.h"
#include "sensor_reader.h"
#include "command_executor.h"
#include "safety_monitor.h"
#include "brain_client.h"

using namespace websockets;

// === MAIN SETUP ===
void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("========================================");
    Serial.println("  Airone Robot Starting...");
    Serial.println("  Robot: zeeb");
    Serial.println("  Brain: wss://zeeb-brain.local:8080");
    Serial.println("========================================");

    // Initialize pins
    pinMode(PIN_LEDPIN, OUTPUT);
    servo_ledpin.attach(PIN_LEDPIN);
    pinMode(PIN_TEMPERATURE_SENSOR, INPUT);
    pinMode(PIN_ULTRASONIC, INPUT);
    pinMode(PIN_CAMERA, INPUT);
    pinMode(PIN_MICROPHONE, INPUT);

    // Initialize DHT sensors
    dht_temperature_sensor.begin();

    // Connect WiFi
    connect_wifi();

    // Connect to brain
    connect_brain();

    Serial.println("[SETUP] Complete. Entering main loop...");
}

// === MAIN LOOP (SENSE → THINK → ACT → SAFETY) ===
void loop() {
    // Poll WebSocket (must be called regularly)
    brain_client.poll();

    // Phase 1: SENSE (read_for)
    read_all_sensors();

    // Phase 2: THINK (senddatato)
    if (brain_connected) {
        send_sensor_data();
    } else {
        // Attempt reconnection with backoff
        attempt_reconnection();
    }

    // Phase 3: ACT (actfor)
    if (new_command_ready) {
        StaticJsonDocument<1024> cmd_doc;
        DeserializationError err = deserializeJson(cmd_doc, pending_command);
        if (!err) {

            if (cmd_doc.containsKey("output_commands")) {
                JsonObject commands = cmd_doc["output_commands"];
                for (JsonPair kv : commands) {
                    const char* module = kv.key().c_str();
                    JsonObject cmd = kv.value();
                    execute_brain_command(module, cmd);
                }
            }
        } else {
            Serial.print("[ERROR] JSON parse failed: ");
            Serial.println(err.c_str());
        }
        new_command_ready = false;
    }

    // Phase 4: SAFETY (always runs, highest priority)
    run_safety_checks();

    // Loop interval
    delay(1000);
}

// ============================================================
// END OF GENERATED FIRMWARE
// ============================================================
