"""
Ollama (local LLaMA) provider for the Goal Brain.

Uses HTTP requests to a locally-running Ollama instance.
No additional packages required beyond aiohttp.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional

import aiohttp

from .base import BaseLLMProvider, LLMResponse

logger = logging.getLogger(__name__)


class OllamaProvider(BaseLLMProvider):
    """Local LLaMA integration via Ollama."""

    provider_name = "ollama"

    def __init__(self, model: str = "llama3",
                 endpoint: str = "http://localhost:11434",
                 api_key: Optional[str] = None, **kwargs: Any):
        super().__init__(api_key=api_key, endpoint=endpoint, **kwargs)
        self.model = model
        self.endpoint = endpoint.rstrip("/")

    async def generate(self, prompt: str, system_prompt: str = "") -> LLMResponse:
        system = system_prompt or (
            "You are a robot control AI. Respond only with valid JSON "
            "mapping module names to command objects with action and value/angle fields."
        )
        full_prompt = f"{system}\n\n{prompt}"

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.endpoint}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": full_prompt,
                        "stream": False,
                        "options": {"temperature": 0.1},
                    },
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    data = await resp.json()
                    content = data.get("response", "")
                    commands = self._parse_json(content)
                    return LLMResponse(
                        commands=commands,
                        reasoning=f"Generated via Ollama/{self.model}",
                        confidence=0.7,
                        model=f"ollama/{self.model}",
                        raw_response=content,
                    )
        except Exception as exc:
            logger.error("Ollama error: %s", exc)
            return LLMResponse(commands={}, reasoning=f"Ollama error: {exc}",
                               confidence=0.0, model=self.provider_name)

    async def test_connection(self) -> Dict[str, Any]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.endpoint}/api/tags",
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        models = [m.get("name", "") for m in data.get("models", [])]
                        return {"success": True, "model": self.model, "available_models": models}
                    return {"success": False, "model": self.model, "error": f"HTTP {resp.status}"}
        except Exception as exc:
            return {"success": False, "model": self.model, "error": str(exc)}

    @staticmethod
    def _parse_json(text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return {}
