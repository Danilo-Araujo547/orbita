export function WorkspaceSkeleton({ label = "Carregando estrutura do Canvas…" }: { label?: string }) {
  return (
    <div className="cv-skel-workspace" role="status" aria-label={label}>
      <div className="cv-skel-rail" aria-hidden="true">
        <span className="cv-skel-rail-dot" />
        <span className="cv-skel-rail-dot" />
        <span className="cv-skel-rail-dot" />
        <span className="cv-skel-rail-dot" />
      </div>
      <div className="cv-skel-panel" aria-hidden="true">
        <span className="cv-skel-line" style={{ width: "45%", height: "14px" }} />
        <span className="cv-skel-line" style={{ width: "100%", height: "28px" }} />
        <span className="cv-skel-line" style={{ width: "85%" }} />
        <span className="cv-skel-line" style={{ width: "72%" }} />
        <span className="cv-skel-line" style={{ width: "90%" }} />
        <span className="cv-skel-line" style={{ width: "64%" }} />
      </div>
      <div className="cv-skel-stage" aria-hidden="true">
        <div className="cv-skel-paper">
          <span className="cv-skel-line" style={{ width: "42%", height: "18px" }} />
          <span className="cv-skel-line" style={{ width: "68%" }} />
          <span className="cv-skel-line" style={{ width: "100%", height: "140px", marginTop: "8px" }} />
          <span className="cv-skel-line" style={{ width: "100%", height: "160px", marginTop: "8px" }} />
        </div>
      </div>
      <div className="cv-skel-panel is-right" aria-hidden="true">
        <span className="cv-skel-line" style={{ width: "55%", height: "14px" }} />
        <span className="cv-skel-line" style={{ width: "100%", height: "28px" }} />
        <span className="cv-skel-line" style={{ width: "78%" }} />
        <span className="cv-skel-line" style={{ width: "92%" }} />
      </div>
    </div>
  );
}

export default function ShellSkeleton({ label = "Carregando editor…" }: { label?: string }) {
  return (
    <main className="report-canvas-page cv-root" aria-label="Editor de relatório">
      <header className="cv-topbar" aria-hidden="true">
        <div className="cv-topbar-toolbar">
          <div className="cv-topbar-left">
            <span className="cv-skel-line" style={{ width: "86px", height: "28px" }} />
            <span className="cv-skel-line" style={{ width: "160px", height: "16px" }} />
          </div>
          <div className="cv-topbar-center">
            <span className="cv-skel-line" style={{ width: "136px", height: "28px" }} />
          </div>
          <div className="cv-topbar-right">
            <span className="cv-skel-line" style={{ width: "110px", height: "28px" }} />
            <span className="cv-skel-line" style={{ width: "76px", height: "32px" }} />
          </div>
        </div>
      </header>
      <WorkspaceSkeleton label={label} />
      <footer className="cv-statusbar" aria-hidden="true">
        <span className="cv-skel-line" style={{ width: "80px" }} />
        <span />
        <span className="cv-skel-line" style={{ width: "64px", justifySelf: "end" }} />
      </footer>
    </main>
  );
}
