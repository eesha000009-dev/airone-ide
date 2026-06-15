#!/usr/bin/env python3
"""
Airo Compiler - .airo to C++ firmware compiler

Part of the Airone System: a unified language for AI-driven robotics.
"""

from setuptools import setup, find_packages

setup(
    name="airo-compiler",
    version="0.2.0",
    description="Converts .airo source files to C++ firmware for ESP32 microcontrollers",
    long_description=open("README.md").read() if __import__("os").path.exists("README.md") else "",
    long_description_content_type="text/markdown",
    author="Airone Project",
    license="MIT",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        "airo_compiler": ["../templates/*.j2"],
    },
    data_files=[
        ("templates", [
            "templates/esp32_main.cpp.j2",
            "templates/esp32_pins.h.j2",
            "templates/esp32_sensors.h.j2",
            "templates/esp32_commands.h.j2",
            "templates/esp32_safety.h.j2",
            "templates/esp32_brain.h.j2",
        ]),
    ],
    install_requires=[
        "jinja2>=3.1",
    ],
    entry_points={
        "console_scripts": [
            "airo-compile=airo_compiler.cli:main",
        ],
    },
    python_requires=">=3.10",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Compilers",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)
