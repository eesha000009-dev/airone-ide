// ============================================================
// GENERATED AIRONE FIRMWARE - SENSOR READER
// Target: ESP32
// DO NOT EDIT MANUALLY - Regenerate from .airo source
// ============================================================
#ifndef SENSOR_READER_H
#define SENSOR_READER_H

#include <Arduino.h>
#include "pin_map.h"


// DHT22 temperature sensor support
#include <DHT.h>
DHT dht_temperature_sensor(PIN_TEMPERATURE_SENSOR, DHT22);

// HC-SR04 ultrasonic sensor support
float read_ultrasonic_cm_ultrasonic() {
    // HC-SR04 on GPIO34
    long duration = pulseIn(PIN_ULTRASONIC, HIGH);
    return duration * 0.034 / 2.0;
}

// === SENSOR DATA STRUCTURE ===
struct SensorData {
    float temperature;  // body/other_sensors/temperature.airo
    float mouth;  // body/speech/mic.airo
    float eyes;  // body/sight/ultrasonic-sensor.airo
    float ears;  // body/hearing/ears.airo
    float llleg;  // body/actuation/lower-left-legs.airo
    float ulleg;  // body/actuation/upper-left-legs.airo
    float lrlegs;  // body/actuation/lower-right-legs.airo
    float urlegs;  // body/actuation/upper-right-legs.airo
    float llhands;  // body/actuation/lower-left-hands.airo
    float lrhands;  // body/actuation/lower-right-hands.airo
    float urhands;  // body/actuation/upper-right-hands.airo
    float ulhands;  // body/actuation/upper-left-hands.airo
};

SensorData current_data;

// === SENSOR READING FUNCTIONS ===
void read_all_sensors() {
    current_data.temperature = dht_temperature_sensor.readTemperature();  // DHT22 on GPIO35
    current_data.mouth = 0;  // TODO: I2S microphone on GPIO32
    current_data.eyes = read_ultrasonic_cm_ultrasonic();  // HC-SR04 on GPIO34
    current_data.ears = 0;  // No pin mapping for ears
    current_data.llleg = 0;  // No pin mapping for llleg
    current_data.ulleg = 0;  // No pin mapping for ulleg
    current_data.lrlegs = 0;  // No pin mapping for lrlegs
    current_data.urlegs = 0;  // No pin mapping for urlegs
    current_data.llhands = 0;  // No pin mapping for llhands
    current_data.lrhands = 0;  // No pin mapping for lrhands
    current_data.urhands = 0;  // No pin mapping for urhands
    current_data.ulhands = 0;  // No pin mapping for ulhands
}

#endif // SENSOR_READER_H
