"""Setup script for the Airone Brain Server package."""

from setuptools import setup, find_packages

setup(
    name="airone-brain-server",
    version="0.1.0",
    description="Airone Brain Server — Triune Brain Architecture for robot control",
    author="Airone Project",
    python_requires=">=3.10",
    packages=find_packages(),
    install_requires=[
        "websockets>=11.0",
        "aiohttp>=3.9",
        "aiosqlite>=0.19",
    ],
    extras_require={
        "openai": ["openai>=1.0"],
        "claude": ["anthropic>=0.18"],
        "all": [
            "openai>=1.0",
            "anthropic>=0.18",
        ],
    },
    entry_points={
        "console_scripts": [
            "brain-server=brain_server.__main__:main",
        ],
    },
)
