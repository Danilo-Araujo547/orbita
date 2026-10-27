import { Lightbulb } from "lucide-react";
import { useTheme } from "../ThemeContext";
import type { ThemePreference } from "../theme";

const options: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Claro" },
  { id: "dark", label: "Escuro" },
  { id: "system", label: "Sistema" },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { preference, resolvedTheme, setTheme } = useTheme();
  const index = Math.max(0, options.findIndex(option => option.id === preference));
  const current = options[index];
  const next = options[(index + 1) % options.length];
  return <button type="button"
    className={`theme-bulb-toggle ${resolvedTheme === "light" ? "is-lit" : ""} ${className}`.trim()}
    aria-label={`Tema: ${current.label}. Alternar para ${next.label.toLowerCase()}`}
    title={`Tema ${current.label.toLowerCase()}. Próximo: ${next.label.toLowerCase()}`}
    onClick={() => setTheme(next.id)}>
    <Lightbulb size={19} strokeWidth={1.8} aria-hidden="true" />
    {preference === "system" && <span className="theme-auto-mark" aria-hidden="true">A</span>}
  </button>;
}
