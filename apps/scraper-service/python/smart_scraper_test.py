"""
Standalone test for scrapegraphai's SmartScraperGraph.

Usage:
    python smart_scraper_test.py <url> "<prompt>"

Backend selection via env var LLM_BACKEND=ollama|openai (default: ollama).
For openai, set OPENAI_API_KEY in the environment.
"""

import json
import os
import sys

from scrapegraphai.graphs import SmartScraperGraph

BACKEND = os.environ.get("LLM_BACKEND", "ollama")

if BACKEND == "openai":
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit("OPENAI_API_KEY is not set. Export it or switch LLM_BACKEND=ollama.")
    llm_config = {
        "api_key": api_key,
        "model": "openai/gpt-4o-mini",
    }
else:
    llm_config = {
        "model": f"ollama/{os.environ.get('OLLAMA_MODEL', 'llama3.2')}",
        "model_tokens": 8192,
        "format": "json",
        "base_url": os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
    }

graph_config = {
    "llm": llm_config,
    "verbose": True,
    "headless": True,
    # CPU-only Ollama inference on multi-chunk pages can exceed the 480s default.
    "timeout": int(os.environ.get("SCRAPER_TIMEOUT", "1800")),
}

source = sys.argv[1] if len(sys.argv) > 1 else "https://scrapegraphai.com/"
prompt = (
    sys.argv[2]
    if len(sys.argv) > 2
    else "Extract useful information from the webpage, including a description of what the company does, founders and social media links"
)

smart_scraper_graph = SmartScraperGraph(
    prompt=prompt,
    source=source,
    config=graph_config,
)

result = smart_scraper_graph.run()
print(json.dumps(result, indent=4))
