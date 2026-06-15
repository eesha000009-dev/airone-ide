// ============================================================
// GENERATED AIRONE FIRMWARE - PIN MAP
// Target: ESP32
// DO NOT EDIT MANUALLY - Regenerate from .airo source
// ============================================================
#ifndef PIN_MAP_H
#define PIN_MAP_H

#include <Arduino.h>

// === PIN DEFINITIONS (from pin defi block) ===
// ledpin -> GPIO2 (output, DIGITAL)
const int PIN_LEDPIN = 2;
// temperature_sensor -> GPIO35 (input, DHT22)
const int PIN_TEMPERATURE_SENSOR = 35;
// ultrasonic -> GPIO34 (input, HC_SR04)
const int PIN_ULTRASONIC = 34;
// camera -> GPIO33 (input, OV2640)
const int PIN_CAMERA = 33;
// microphone -> GPIO32 (input, I2S_MIC)
const int PIN_MICROPHONE = 32;

// === SERVO OBJECTS (for output pins) ===
Servo servo_ledpin;

#endif // PIN_MAP_H
