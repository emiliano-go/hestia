"""Provider presets for common OpenAI-compatible endpoints."""

PRESETS = {
    "opencode": {
        "name": "OpenCode Go",
        "base_url": "https://opencode.ai/zen/go",
        "api_key_env": "OPENCODE_API_KEY",
        "model": "deepseek-v4.1-flash",
    },
    "kimi": {
        "name": "Kimi (Moonshot)",
        "base_url": "https://api.moonshot.ai",
        "api_key_env": "KIMI_API_KEY",
        "model": "kimi-k2-0905-preview",
    },
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "api_key_env": "DEEPSEEK_API_KEY",
        "model": "deepseek-chat",
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com",
        "api_key_env": "OPENAI_API_KEY",
        "model": "gpt-4o-mini",
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api",
        "api_key_env": "OPENROUTER_API_KEY",
        "model": "openrouter/auto",
    },
    "ollama": {
        "name": "Ollama (self-hosted)",
        "base_url": "http://localhost:11434",
        "api_key_env": "OLLAMA_API_KEY",
        "model": "llama3.1",
    },
    "custom": {
        "name": "Custom (self-hosted vLLM, llama.cpp, ...)",
        "base_url": "http://localhost:8000",
        "api_key_env": "CUSTOM_API_KEY",
        "model": "",
    },
}
