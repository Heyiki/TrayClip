import { useState } from "react";
import { Check, Copy, Languages } from "lucide-react";
import { bingTranslate } from "@/lib/api";
import { translateText } from "@/lib/llm";
import type { LLMConfig } from "@/lib/llm";
import { useTranslation } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

const LANGUAGES = [
  { code: "zh-Hans", label: "中文", llmCode: "zh" },
  { code: "en", label: "English", llmCode: "en" },
  { code: "ja", label: "日本語", llmCode: "ja" },
  { code: "ko", label: "한국어", llmCode: "ko" },
  { code: "fr", label: "Français", llmCode: "fr" },
  { code: "es", label: "Español", llmCode: "es" },
  { code: "de", label: "Deutsch", llmCode: "de" },
  { code: "ru", label: "Русский", llmCode: "ru" },
];

interface TranslateDialogProps {
  text: string;
  llmConfig: LLMConfig;
  llmEnabled: boolean;
  aiTranslate: boolean;
  onClose: () => void;
}

export function TranslateDialog({
                                  text,
                                  llmConfig,
                                  llmEnabled,
                                  aiTranslate,
                                  onClose,
                                }: TranslateDialogProps) {
  const useAI = aiTranslate && llmEnabled;
  const { t, locale } = useTranslation();
  const [targetLang, setTargetLang] = useState(() => (locale === "zh-CN" ? "zh-Hans" : "en"));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inputText, setInputText] = useState(text);

  const handleTranslate = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      let translated: string;
      if (useAI) {
        const lang = LANGUAGES.find((l) => l.code === targetLang);
        translated = await translateText(llmConfig, inputText, lang?.llmCode ?? targetLang);
      } else {
        translated = await bingTranslate(inputText, "", targetLang);
      }
      setResult(translated);
    } catch {
      setError(t.translateFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (result) void navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-[360px]" onContextMenu={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-sm">
              <Languages className="h-4 w-4" /> {t.translate}
            </DialogTitle>
            <DialogDescription className="sr-only">{t.translate}</DialogDescription>
          </DialogHeader>

          <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <div className="flex items-center gap-2">
            <Select value={targetLang} onValueChange={setTargetLang}>
              <SelectTrigger className="flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code} className="text-xs">
                      {l.label}
                    </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => void handleTranslate()}
                disabled={loading}
            >
              {loading ? t.translating : t.translateBtn}
            </Button>
          </div>

          {loading ? (
              <p className="py-3 text-center text-sm text-muted-foreground">{t.translating}</p>
          ) : error ? (
              <p className="py-3 text-sm text-destructive">{error}</p>
          ) : result ? (
              <ScrollArea className="max-h-[200px]">
            <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted p-2.5 font-sans text-xs leading-relaxed">
              {result}
            </pre>
              </ScrollArea>
          ) : null}

          <p className="text-center text-[11px] text-muted-foreground">
            {useAI ? t.aiDisclaimer : t.bingSource}
          </p>

          {!loading && !error && result ? (
              <Button
                  size="sm"
                  className="w-full"
                  onClick={handleCopy}
              >
                {copied ? (
                    <><Check className="mr-1.5 h-3.5 w-3.5" /> {t.copiedToClipboard}</>
                ) : (
                    <><Copy className="mr-1.5 h-3.5 w-3.5" /> {t.copyResult}</>
                )}
              </Button>
          ) : null}
        </DialogContent>
      </Dialog>
  );
}
