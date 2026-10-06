"""Provider presets for common OpenAI-compatible endpoints."""

PRESETS = {
    "opencode": {
        "name": "OpenCode Go",
        "base_url": "https://opencode.ai/zen/go",
        "model": "deepseek-v4.1-flash",
    },
    "kimi": {
        "name": "Kimi (Moonshot)",
        "base_url": "https://api.moonshot.ai",
        "model": "kimi-k2-0905-preview",
    },
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com",
        "model": "gpt-4o-mini",
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api",
        "model": "openrouter/auto",
    },
    "ollama": {
        "name": "Ollama (self-hosted)",
        "base_url": "http://localhost:11434",
        "model": "llama3.1",
    },
    "custom": {
        "name": "Custom (self-hosted vLLM, llama.cpp, ...)",
        "base_url": "http://localhost:8000",
        "model": "",
    },
}
