import { Check, ChevronDown, Copy, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, cx, Input, Textarea, useToast } from "../../components/ui";

/** A prompt for ChatGPT, Claude, Gemini… whose answer pastes straight into a roadmap. */
export function roadmapPrompt(topic: string): string {
  return `Create a study roadmap for: ${topic.trim() || "<WHAT YOU WANT TO LEARN, YOUR LEVEL, HOW MANY WEEKS>"}.

Output ONLY the roadmap as plain text, one item per line, in exactly this format:

# Section name
Topic to study (45m)
Title of an article or video — https://full-link (30m)
https://leetcode.com/problems/<problem-slug>/
https://codeforces.com/problemset/problem/<contest-id>/<index>

Rules:
- Start every section with "# " followed by its name, e.g. "# Week 1 — Basics".
- End each line with an estimated time in brackets, e.g. (30m), (45m) or (1h 30m).
- For a coding problem, write only its full problem URL (LeetCode or Codeforces).
- Use only real, existing links. If unsure about a link, write the topic as plain text instead.
- 4–8 items per section, easiest first.
- No introduction, explanations, tables or code blocks — only the lines of the roadmap.`;
}

export function AiPromptHelp({ className }: { className?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [copied, setCopied] = useState(false);
  const prompt = roadmapPrompt(topic);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast("Prompt copied — paste it into ChatGPT, Claude or Gemini, then paste the answer here", "ok");
    } catch {
      toast("Couldn't copy automatically — select the text and copy it", "error");
    }
  };

  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
        <Sparkles className="size-3.5" aria-hidden />
        Get this list from an AI
        <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface-2 p-3">
          <p className="text-xs text-muted">Describe what you want to learn, copy the prompt into any AI chat, and paste its answer into the box above.</p>
          <Input
            aria-label="What do you want to learn?"
            placeholder="e.g. system design for interviews, intermediate, 6 weeks"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={200}
          />
          <Textarea aria-label="Prompt to copy" readOnly rows={8} value={prompt} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[12px]" />
          <div className="flex justify-end">
            <Button size="sm" onClick={copy} icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}>
              {copied ? "Copied" : "Copy prompt"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
