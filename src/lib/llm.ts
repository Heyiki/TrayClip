export interface LLMConfig {
    apiUrl: string;
    apiKey: string;
    model: string;
}

const SYSTEM_PROMPT = "You are a text processing assistant. Output result only, no explanation.";

/// Nothing caps `fetch` on its own: a server that accepts the socket but never sends a
/// body would keep the dialog loading forever, so every completion gets a deadline.
const LLM_TIMEOUT_MS = 30_000;

export class LLMTimeoutError extends Error {
    constructor() {
        super(`AI request timed out after ${LLM_TIMEOUT_MS / 1000}s`);
        this.name = "LLMTimeoutError";
    }
}

/// Callers cancel by aborting their own signal, so a timeout has to stay distinguishable
/// from a cancellation — otherwise the loading state could never be reset.
export function isLLMTimeoutError(error: unknown): error is LLMTimeoutError {
    return error instanceof LLMTimeoutError;
}

/// WKWebView only gained `AbortSignal.any` with Safari 17.4, and older macOS builds are
/// still around. Bridging manually keeps the deadline working there instead of failing
/// every request with a TypeError.
function mergeSignals(signals: AbortSignal[]): AbortSignal {
    const any = (AbortSignal as { any?: (list: AbortSignal[]) => AbortSignal }).any;
    if (any) return any(signals);

    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}

const LANG_NAMES: Record<string, string> = {
    zh: "Chinese",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    es: "Spanish",
    de: "German",
    ru: "Russian",
};

async function callLLM(
    config: LLMConfig,
    taskPrompt: string,
    userContent: string,
    options?: { temperature?: number; signal?: AbortSignal },
): Promise<string> {
    const url = config.apiUrl.replace(/\/+$/, "") + "/chat/completions";
    const userMessage = `${taskPrompt}\n\n<clipboard>\n${userContent}\n</clipboard>`;

    // The deadline lives on its own controller: if it aborted the caller's signal too,
    // a timeout would be indistinguishable from the dialog being closed.
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(new LLMTimeoutError()), LLM_TIMEOUT_MS);
    const signal = options?.signal
        ? mergeSignals([options.signal, timeoutController.signal])
        : timeoutController.signal;

    try {
        const resp = await fetch(url, {
            method: "POST",
            signal,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userMessage },
                ],
                temperature: options?.temperature ?? 0.2,
            }),
        });

        if (!resp.ok) {
            throw new Error(`API error: ${resp.status}`);
        }

        const data = await resp.json();
        return data.choices?.[0]?.message?.content?.trim() ?? "";
    } finally {
        clearTimeout(timer);
    }
}

export async function extractKeywords(config: LLMConfig, text: string, signal?: AbortSignal): Promise<string> {
    return callLLM(
        config,
        "Extract the main keywords from the text. Return them as a comma-separated list. Use the same language as the source text.",
        text,
        { temperature: 0.2, signal },
    );
}

export async function summarizeText(config: LLMConfig, text: string, signal?: AbortSignal): Promise<string> {
    return callLLM(
        config,
        "Provide a concise summary of the text. Use the same language as the source text.",
        text,
        { temperature: 0.3, signal },
    );
}

export async function translateText(config: LLMConfig, text: string, targetLang: string, signal?: AbortSignal): Promise<string> {
    const langName = LANG_NAMES[targetLang] ?? targetLang;
    return callLLM(
        config,
        `Translate the following text into ${langName}. If the text is already in ${langName}, translate it into English instead.`,
        text,
        { temperature: 0, signal },
    );
}
