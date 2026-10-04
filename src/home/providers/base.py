"""OpenAI-compatible chat-completions client (async, streaming, tool calling)."""

import os
from typing import Any, AsyncIterator

import httpx


class ProviderError(RuntimeError):
    pass


class OpenAIClient:
    def __init__(self, base_url: str, api_key: str | None, model: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield raw SSE chunks from /chat/completions."""
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if tools:
            payload["tools"] = tools
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/v1/chat/completions",
                headers=self._headers(),
                json=payload,
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise ProviderError(
                        f"{resp.status_code}: {body.decode('utf-8', 'replace')[:500]}"
                    )
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line.removeprefix("data:").strip()
                    if data == "[DONE]":
                        return
                    import json

                    yield json.loads(data)

    async def test_connection(self) -> dict[str, Any]:
        """Cheap liveness check: 1-token completion."""
        chunks = []
        async for chunk in self.stream_chat(
            [{"role": "user", "content": "ping"}], tools=None
        ):
            chunks.append(chunk)
            break
        return chunks[0] if chunks else {}


def resolve_api_key(api_key_env: str) -> str | None:
    return os.environ.get(api_key_env) or None
