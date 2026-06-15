// ============================================================
// GENERATED AIRONE FIRMWARE - BRAIN CLIENT
// Target: ESP32
// DO NOT EDIT MANUALLY - Regenerate from .airo source
// ============================================================
#ifndef BRAIN_CLIENT_H
#define BRAIN_CLIENT_H

#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>

using namespace websockets;

// === BRAIN CONNECTION CONFIG ===
const char* BRAIN_HOST = "zeeb-brain.local";
const int BRAIN_PORT = 8080;
const char* BRAIN_PATH = "/";
const bool BRAIN_SECURE = true;

// === WiFi CONFIG ===
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// === BRAIN CLIENT STATE ===
WebsocketsClient brain_client;
volatile bool brain_connected = false;
volatile bool new_command_ready = false;
String pending_command = "";


// === WEBSOCKET CALLBACKS ===
void on_brain_message(WebsocketsMessage message) {
    pending_command = message.data();
    new_command_ready = true;
}

void on_brain_event(WebsocketsEvent event, String data) {
    if (event == WebsocketsEvent::ConnectionOpened) {
        brain_connected = true;
        Serial.println("[BRAIN] Connected!");
    }
    if (event == WebsocketsEvent::ConnectionClosed) {
        brain_connected = false;
        Serial.println("[BRAIN] Disconnected!");
    }
}

// === WiFi CONNECTION ===
void connect_wifi() {
    Serial.print("[WIFI] Connecting to ");
    Serial.print(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WIFI] Connected!");
        Serial.print("[WIFI] IP: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n[WIFI] FAILED to connect!");
    }
}

// === BRAIN CONNECTION ===
void connect_brain() {
    brain_client.onMessage(on_brain_message);
    brain_client.onEvent(on_brain_event);

    Serial.print("[BRAIN] Connecting to ");
    Serial.print(BRAIN_HOST);
    Serial.print(":");
    Serial.println(BRAIN_PORT);

    if (brain_client.connect(BRAIN_HOST, BRAIN_PORT, BRAIN_PATH)) {
        Serial.println("[BRAIN] Connection initiated!");
    } else {
        Serial.println("[BRAIN] Connection FAILED!");
    }
}

// === RECONNECTION WITH EXPONENTIAL BACKOFF ===
unsigned long last_reconnect_attempt = 0;
int reconnect_delay_ms = 1000;  // Start at 1 second
const int MAX_RECONNECT_DELAY = 30000;  // Cap at 30 seconds

void attempt_reconnection() {
    if (brain_connected) return;

    unsigned long now = millis();
    if (now - last_reconnect_attempt < (unsigned long)reconnect_delay_ms) return;

    Serial.println("[BRAIN] Attempting reconnection...");
    last_reconnect_attempt = now;

    // Check WiFi first
    if (WiFi.status() != WL_CONNECTED) {
        connect_wifi();
        return;
    }

    if (brain_client.connect(BRAIN_HOST, BRAIN_PORT, BRAIN_PATH)) {
        Serial.println("[BRAIN] Reconnected!");
        reconnect_delay_ms = 1000;  // Reset delay
    } else {
        Serial.println("[BRAIN] Reconnection failed, backing off...");
        reconnect_delay_ms = min(reconnect_delay_ms * 2, MAX_RECONNECT_DELAY);
    }
}

// === SEND SENSOR DATA TO BRAIN ===
void send_sensor_data() {
    if (!brain_connected) return;

    StaticJsonDocument<4096> doc;
    doc["robot_id"] = "zeeb";
    doc["timestamp"] = millis();

    JsonObject sensors = doc.createNestedObject("input_sensors_read");
    sensors["temperature"] = current_data.temperature;
    sensors["mouth"] = current_data.mouth;
    sensors["eyes"] = current_data.eyes;
    sensors["ears"] = current_data.ears;
    sensors["llleg"] = current_data.llleg;
    sensors["ulleg"] = current_data.ulleg;
    sensors["lrlegs"] = current_data.lrlegs;
    sensors["urlegs"] = current_data.urlegs;
    sensors["llhands"] = current_data.llhands;
    sensors["lrhands"] = current_data.lrhands;
    sensors["urhands"] = current_data.urhands;
    sensors["ulhands"] = current_data.ulhands;

    JsonArray available = doc.createNestedArray("output_modules_available");
    available.add("ledpin");
    available.add("urhands");
    available.add("llleg");


    JsonObject status = doc.createNestedObject("system_status");
    status["uptime_seconds"] = millis() / 1000;
    status["brain_connected"] = brain_connected;
    status["safe_mode"] = safe_mode_active;

    String json;
    serializeJson(doc, json);
    brain_client.send(json);
}

#endif // BRAIN_CLIENT_H
