// Registry of supported AI providers for the natural-language screener.
// Pure constants only — safe to import from both client components and server
// code. Used by the Settings credentials form (dropdowns) and by the NL-query
// dispatch that routes a request to the chosen provider.

export type AIProvider = "anthropic" | "openai" | "google";

export interface AIProviderMeta {
  key: AIProvider;
  label: string;
  /** Common preset model IDs shown in the dropdown; users may also type a custom one. */
  models: string[];
  /** Where to obtain an API key (shown as a hint under the key field). */
  keyHint: string;
}

export const AI_PROVIDERS: AIProviderMeta[] = [
  {
    key: "anthropic",
    label: "Anthropic (Claude)",
    models: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    keyHint: "Get a key at console.anthropic.com",
  },
  {
    key: "openai",
    label: "OpenAI (GPT)",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
    keyHint: "Get a key at platform.openai.com/api-keys",
  },
  {
    key: "google",
    label: "Google (Gemini)",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    keyHint: "Get a key at aistudio.google.com/apikey",
  },
];

export const DEFAULT_MODEL_BY_PROVIDER: Record<AIProvider, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
};

export const AI_PROVIDER_KEYS: AIProvider[] = AI_PROVIDERS.map((p) => p.key);

export function isAIProvider(value: string | null | undefined): value is AIProvider {
  return value != null && AI_PROVIDER_KEYS.includes(value as AIProvider);
}

export function providerLabel(key: AIProvider): string {
  return AI_PROVIDERS.find((p) => p.key === key)?.label ?? key;
}
