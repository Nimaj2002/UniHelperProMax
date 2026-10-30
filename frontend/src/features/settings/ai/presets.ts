/** Presets for Settings → AI. Provider names follow learnharness' AUTH_PROVIDER_KEYS (pi-ai's built-ins);
 *  base URLs are each provider's public API. */
import type { AiStyleId } from "./api";

export interface Preset {
  id: string;
  name: string;
  style: AiStyleId;
  baseUrl: string;
}

export const WELL_KNOWN: Preset[] = [
  { id: "openai", name: "OpenAI", style: "openai", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", style: "anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "google", name: "Google Gemini", style: "gemini", baseUrl: "https://generativelanguage.googleapis.com" },
  { id: "openrouter", name: "OpenRouter", style: "openai", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "deepseek", name: "DeepSeek", style: "openai", baseUrl: "https://api.deepseek.com/v1" },
  { id: "xai", name: "xAI", style: "openai", baseUrl: "https://api.x.ai/v1" },
  { id: "mistral", name: "Mistral", style: "openai", baseUrl: "https://api.mistral.ai/v1" },
  { id: "groq", name: "Groq", style: "openai", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "cerebras", name: "Cerebras", style: "openai", baseUrl: "https://api.cerebras.ai/v1" },
  { id: "together", name: "Together", style: "openai", baseUrl: "https://api.together.xyz/v1" },
  { id: "fireworks", name: "Fireworks", style: "openai", baseUrl: "https://api.fireworks.ai/inference/v1" },
  { id: "baseten", name: "Baseten", style: "openai", baseUrl: "https://inference.baseten.co/v1" },
  { id: "huggingface", name: "Hugging Face", style: "openai", baseUrl: "https://router.huggingface.co/v1" },
  { id: "nvidia", name: "NVIDIA", style: "openai", baseUrl: "https://integrate.api.nvidia.com/v1" },
  { id: "meta", name: "Meta", style: "openai", baseUrl: "https://api.llama.com/compat/v1" },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", style: "openai", baseUrl: "https://ai-gateway.vercel.sh/v1" },
  { id: "opencode", name: "OpenCode Zen", style: "openai", baseUrl: "https://opencode.ai/zen/v1" },
  { id: "moonshotai", name: "Moonshot AI", style: "openai", baseUrl: "https://api.moonshot.ai/v1" },
  { id: "moonshotai-cn", name: "Moonshot AI CN", style: "openai", baseUrl: "https://api.moonshot.cn/v1" },
  { id: "kimi-coding", name: "Kimi For Coding", style: "openai", baseUrl: "https://api.kimi.com/coding/v1" },
  { id: "minimax", name: "MiniMax", style: "openai", baseUrl: "https://api.minimax.io/v1" },
  { id: "minimax-cn", name: "MiniMax CN", style: "openai", baseUrl: "https://api.minimaxi.com/v1" },
  { id: "qwen", name: "Qwen (Alibaba Cloud)", style: "openai", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  { id: "qwen-cn", name: "Qwen CN (Alibaba Cloud)", style: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "zai", name: "Z.AI", style: "openai", baseUrl: "https://api.z.ai/api/paas/v4" },
  { id: "zai-coding-cn", name: "Z.AI Coding CN", style: "openai", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4" },
  { id: "xiaomi", name: "Xiaomi MiMo", style: "openai", baseUrl: "https://api.xiaomimimo.com/v1" },
];

/** Servers that run on this computer; all speak the OpenAI-compatible style and need no key. */
export const LOCAL_SERVERS: Preset[] = [
  { id: "ollama", name: "Ollama", style: "openai", baseUrl: "http://localhost:11434/v1" },
  { id: "lm-studio", name: "LM Studio", style: "openai", baseUrl: "http://localhost:1234/v1" },
  { id: "llama-cpp", name: "llama.cpp server", style: "openai", baseUrl: "http://localhost:8080/v1" },
  { id: "vllm", name: "vLLM", style: "openai", baseUrl: "http://localhost:8000/v1" },
  { id: "jan", name: "Jan", style: "openai", baseUrl: "http://localhost:1337/v1" },
];

export const findPreset = (list: Preset[], style: AiStyleId, baseUrl: string) =>
  list.find((p) => p.style === style && p.baseUrl === baseUrl.trim().replace(/\/+$/, ""));
