"""
OpenAI GPT-4 provider for the Goal Brain.

Uses the `openai` Python package (v1+).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from .base import BaseLLMProvider, LLMResponse

logger = logging.getLogger(__name__)


class OpenAIProvider(BaseLLMProvider):
    """GPT-4 integration via the OpenAI API."""

    provider_name = "openai"

    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4",
                 endpoint: Optional[str] = None, **kwargs: Any):
        super().__init__(api_key=api_key, endpoint=endpoint, **kwargs)
        self.model = model
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from openai import AsyncOpenAI
                self._client = AsyncOpenAI(api_key=self.api_key, base_url=self.endpoint)
            except ImportError:
                raise RuntimeError("openai package not installed. Run: pip install openai")
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
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=500,
            )
            content = response.choices[0].message.content or ""
            commands = self._parse_json(content)
            return LLMResponse(
                commands=commands,
                reasoning=f"Generated via {self.model}",
                confidence=0.9,
                model=self.model,
                raw_response=content,
            )
        except Exception as exc:
            logger.error("OpenAI error: %s", exc)
            return LLMResponse(commands={}, reasoning=f"OpenAI error: {exc}",
                               confidence=0.0, model=self.provider_name)

    async def test_connection(self) -> Dict[str, Any]:
        if not self.api_key:
            return {"success": False, "model": self.model, "error": "No API key configured"}
        try:
            client = self._get_client()
            models = await client.models.list()
            model_ids = [m.id for m in models.data][:5]
            return {"success": True, "model": self.model, "available_models": model_ids}
        except Exception as exc:
            return {"success": False, "model": self.model, "error": str(exc)}

    @staticmethod
    def _parse_json(text: str) -> Dict[str, Any]:
        """Best-effort JSON extraction from LLM output."""
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
        # Try to find a JSON object in the text
        import re
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return {}
