"""
Anthropic Claude provider for the Goal Brain.

Uses the `anthropic` Python package.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional

from .base import BaseLLMProvider, LLMResponse

logger = logging.getLogger(__name__)


class ClaudeProvider(BaseLLMProvider):
    """Claude integration via the Anthropic API."""

    provider_name = "claude"

    def __init__(self, api_key: Optional[str] = None, model: str = "claude-3-5-sonnet-20241022",
                 endpoint: Optional[str] = None, **kwargs: Any):
        super().__init__(api_key=api_key, endpoint=endpoint, **kwargs)
        self.model = model
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                import anthropic
                self._client = anthropic.AsyncAnthropic(api_key=self.api_key, base_url=self.endpoint)
            except ImportError:
                raise RuntimeError("anthropic package not installed. Run: pip install anthropic")
        return self._client

    async def generate(self, prompt: str, system_prompt: str = "") -> LLMResponse:
        if not self.api_key:
            return LLMResponse(commands={}, reasoning="No API key configured",
                               confidence=0.0, model=self.provider_name)

        client = self._get_client()
        system = system_prompt or (
            "You are a robot control AI. Respond only with valid JSON "
            "mapping module names to command objects with action and value/angle fields."
        )

        try:
            response = await client.messages.create(
                model=self.model,
                max_tokens=500,
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )
            content = response.content[0].text if response.content else ""
            commands = self._parse_json(content)
            return LLMResponse(
                commands=commands,
                reasoning=f"Generated via {self.model}",
                confidence=0.9,
                model=self.model,
                raw_response=content,
            )
        except Exception as exc:
            logger.error("Claude error: %s", exc)
            return LLMResponse(commands={}, reasoning=f"Claude error: {exc}",
                               confidence=0.0, model=self.provider_name)

    async def test_connection(self) -> Dict[str, Any]:
        if not self.api_key:
            return {"success": False, "model": self.model, "error": "No API key configured"}
        try:
            client = self._get_client()
            # Send a minimal request to verify connectivity
            resp = await client.messages.create(
                model=self.model,
                max_tokens=10,
                messages=[{"role": "user", "content": "Hello"}],
            )
            return {"success": True, "model": self.model}
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
