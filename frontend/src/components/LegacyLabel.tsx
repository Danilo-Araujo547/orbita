import type { ReactNode } from "react";

export default function LegacyLabel({ children, legacy = false }: { children: ReactNode; legacy?: boolean }) {
  if (!legacy) return <>{children}</>;
  return <span className="legacy-label"><span>{children}</span>{legacy && <span className="legacy-badge">Legado</span>}</span>;
}
