import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings } from "@/lib/types";
import { extractKeywords, isLLMTimeoutError, summarizeText } from "@/lib/llm";
import { useTranslation } from "@/lib/i18n";

interface LlmState {
    loading: boolean;
    action: string;
    result: string | null;
    error: string | null;
}

const IDLE: LlmState = { loading: false, action: "", result: null, error: null };

export function useClipLlm(settings: AppSettings) {
    const { t } = useTranslation();
    const [llmState, setLlmState] = useState<LlmState>(IDLE);
    const abortRef = useRef<AbortController | null>(null);

    // Cards unmount while a request is in flight whenever the list reloads or the card
    // scrolls out of the virtual window; abort instead of resolving into a dead component.
    useEffect(() => () => abortRef.current?.abort(), []);

    const config = useMemo(
        () => ({ apiUrl: settings.llm_api_url, apiKey: settings.llm_api_key, model: settings.llm_model }),
        [settings.llm_api_url, settings.llm_api_key, settings.llm_model],
    );

    const enabled = !!(settings.llm_enabled && settings.llm_api_url && settings.llm_api_key && settings.llm_model);

    const start = useCallback((action: string) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLlmState({ loading: true, action, result: null, error: null });
        return controller.signal;
    }, []);

    const close = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setLlmState(IDLE);
    }, []);

    const handleExtractKeywords = useCallback(async (text: string) => {
        const signal = start(t.extractKeywords);
        try {
            const keywords = await extractKeywords(config, text, signal);
            setLlmState({ loading: false, action: "", result: keywords, error: null });
        } catch (error) {
            // An aborted signal means the dialog is already gone; only real failures reset
            // the loading state, and a stalled request gets its own message.
            if (signal.aborted) return;
            setLlmState({ loading: false, action: "", result: null, error: isLLMTimeoutError(error) ? t.aiTimeout : t.aiFailed });
        }
    }, [config, start, t.extractKeywords, t.aiFailed, t.aiTimeout]);

    const handleSummarize = useCallback(async (text: string) => {
        const signal = start(t.aiSummarize);
        try {
            const summary = await summarizeText(config, text, signal);
            setLlmState({ loading: false, action: "", result: summary, error: null });
        } catch (error) {
            if (signal.aborted) return;
            setLlmState({ loading: false, action: "", result: null, error: isLLMTimeoutError(error) ? t.aiTimeout : t.aiFailed });
        }
    }, [config, start, t.aiSummarize, t.aiFailed, t.aiTimeout]);

    return { llmState, enabled, config, close, handleExtractKeywords, handleSummarize };
}
