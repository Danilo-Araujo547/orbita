import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "../ThemeContext";
import type { ThemePreference } from "../theme";

const options: {
  id: ThemePreference;
  label: string;
  icon: typeof Sun;
  description: string;
}[] = [
  { id: "light", label: "Claro", icon: Sun, description: "Tema claro" },
  { id: "dark", label: "Escuro", icon: Moon, description: "Tema escuro" },
  {
    id: "system",
    label: "Sistema",
    icon: Monitor,
    description: "Acompanhar preferência do sistema operacional",
  },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { preference, setTheme } = useTheme();
  const index = options.findIndex((option) => option.id === preference);
  const current = options[index];
  const next = options[(index + 1) % options.length];
  const Icon = current.icon;
  return (
    <button
      type="button"
      className={`theme-cycle ${className}`}
      aria-label={`Tema ${current.label.toLowerCase()}. Alternar para ${next.label.toLowerCase()}`}
      title={`Tema: ${current.label} · Próximo: ${next.label}`}
      onClick={() => setTheme(next.id)}
    >
      <Icon size={17} aria-hidden="true" />
      <span>{current.label}</span>
    </button>
  );
}
