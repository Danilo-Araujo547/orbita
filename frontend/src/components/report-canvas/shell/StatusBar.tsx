import type { ReactNode } from "react";

export interface StatusBarProps {
  children?: ReactNode;
}

// Stub preparado para a barra de status inferior nas próximas tarefas; sem impacto visual hoje.
export default function StatusBar({ children }: StatusBarProps) {
  if (!children) return null;
  return (
    <footer className="rc-statusbar" role="status">
      {children}
    </footer>
  );
}
