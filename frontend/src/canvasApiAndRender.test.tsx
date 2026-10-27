import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReportCanvas from "./components/ReportCanvas";
import {
  CanvasSaveError,
  fetchCanvasRequest,
  previewCanvasRequest,
  saveCanvasRequest,
  validateAssetFile,
} from "./components/report-canvas/api/useCanvasApi";
import Inspector from "./components/report-canvas/inspector/Inspector";
import BlockLibrary from "./components/report-canvas/library/BlockLibrary";
import PagesPanel from "./components/report-canvas/library/PagesPanel";
import DataPanel from "./components/report-canvas/data/DataPanel";
import ImagesPanel from "./components/report-canvas/library/ImagesPanel";
import LeftRail from "./components/report-canvas/shell/LeftRail";
import TopBar, { CanvasHeaderControls } from "./components/report-canvas/shell/TopBar";
import Stage from "./components/report-canvas/stage/Stage";
import { createDefaultLayout, sanitizeLayoutForApi } from "./components/report-canvas/model";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cliente de API do Canvas com request mockado (load, save, preview, conflito e upload)", () => {
  it("carrega e normaliza o layout do relatório", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 4,
          enabled: true,
          output_format: "pdf",
          sources: [{ id: 10, name: "Atendimentos", code: "atend" }],
          assets: [],
          layout: {
            schema_version: 1,
            page: { width: 794, height: 1123, columns: 24, background: "#ffffff" },
            sources: [],
            pages: [{ id: "p1", name: "Principal", blocks: [] }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchCanvasRequest(50, "ame");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.data.version).toBe(4);
    expect(res.normalizedLayout.pages[0].name).toBe("Principal");
  });

  it("envia payload exato ao salvar (sem tocar em banco real) e detecta conflito 409", async () => {
    const layout = createDefaultLayout();
    layout.pages[0].blocks.push({
      id: "b1",
      type: "text",
      x: 40,
      y: 40,
      width: 380,
      height: 110,
      title: "Título",
      text: "Corpo",
      options: { color: "#075b94", font_size: 15 },
    });
    const clean = sanitizeLayoutForApi(layout);

    const fetchOk = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 5,
          enabled: false,
          output_format: "xlsx",
          sources: [],
          assets: [],
          layout: clean,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchOk);

    const saved = await saveCanvasRequest(50, "ame", {
      version: 4,
      layout: clean,
      enabled: false,
      outputFormat: "xlsx",
    });
    expect(saved.saved.version).toBe(5);
    const [, init] = fetchOk.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      version: 4,
      layout: clean,
      enabled: false,
      output_format: "xlsx",
    });

    // Conflito de versão (409)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ detail: "Conflito de versão: relatório alterado por outro usuário." }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(
      saveCanvasRequest(50, "ame", {
        version: 4,
        layout: clean,
        enabled: true,
        outputFormat: "pdf",
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CanvasSaveError &&
        err.isConflict === true &&
        err.message.includes("Recarregue os dados do relatório"),
    );
  });

  it("gera prévia em PDF/XLSX a partir de base64 e valida arquivos de imagem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: btoa("%PDF-1.4 mock"),
            format: "pdf",
            rows: 0,
            filename: "previa-50.pdf",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const prev = await previewCanvasRequest(50, "ame", {
      layout: createDefaultLayout(),
      parameters: { start_date: "2026-10-01" },
      format: "pdf",
    });
    expect(prev.filename).toBe("previa-50.pdf");
    expect(prev.format).toBe("pdf");
    expect(prev.blob.type).toBe("application/pdf");
    expect(prev.info).toContain("Nenhum dado encontrado");

    expect(validateAssetFile(new File(["abc"], "doc.gif", { type: "image/gif" }))).toContain("PNG ou JPEG");
    expect(validateAssetFile(new File([], "vazio.png", { type: "image/png" }))).toContain("vazio");
    expect(validateAssetFile(new File(["ok"], "logo.png", { type: "image/png" }))).toBeNull();
  });
});

describe("Renderização estática dos módulos extraídos (preservação estrutural e classes CSS)", () => {
  it("renderiza ReportCanvas inicial com classe cv-root no shell e controles principais", () => {
    const html = renderToStaticMarkup(
      <ReportCanvas
        unit="ame"
        report={{ id: 50, name: "Relatório Assistencial", version: 2 }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('class="report-canvas-page cv-root"');
    expect(html).toContain("Relatório Assistencial");
    expect(html).toContain("Usar Canvas");
    expect(html).toContain("Dados de exemplo");
    expect(html).toContain('class="rc-toolbar"');
    expect(html).toContain("Carregando estrutura do Canvas…");
  });

  it("renderiza TopBar, LeftRail, Stage e Inspector com os mesmos atributos e classes do baseline", () => {
    const layout = createDefaultLayout();
    layout.pages[0].blocks.push({
      id: "b1",
      type: "kpi",
      x: 40,
      y: 40,
      width: 230,
      height: 125,
      title: "Atendimentos",
      options: { color: "#075b94", font_size: 28, aggregate: "sum", precision: 0 },
    });
    const block = layout.pages[0].blocks[0];

    const workspaceHtml = renderToStaticMarkup(
      <div>
        <CanvasHeaderControls
          enabled
          outputFormat="pdf"
          dirty
          loading={false}
          busy={false}
          showSampleData
          onChangeEnabled={() => {}}
          onChangeOutputFormat={() => {}}
          onChangeShowSampleData={() => {}}
          onOpenPreview={() => {}}
          onSave={() => {}}
        />
        <TopBar
          pages={layout.pages}
          activePageId="p1"
          pageConfig={layout.page}
          loading={false}
          busy={false}
          showGrid
          zoom={0.85}
          rightOpen
          leftWidth={224}
          rightWidth={280}
          onSelectPage={() => {}}
          onUpdatePageConfig={() => {}}
          onToggleGrid={() => {}}
          onChangeZoom={() => {}}
          onFitToWidth={() => {}}
          onReload={() => {}}
          onToggleRightPanel={() => {}}
          onChangeLeftWidth={() => {}}
          onChangeRightWidth={() => {}}
        />
        <LeftRail
          leftOpen
          libraryTab="components"
          onSelectLibrary={() => {}}
          onCloseLeftPanel={() => {}}
        >
          <BlockLibrary active loading={false} onAddComponent={() => {}} />
          <PagesPanel
            active={false}
            pages={layout.pages}
            activePage={layout.pages[0]}
            pageConfig={layout.page}
            onSelectPage={() => {}}
            onAddCoverPage={() => {}}
            onAddBlankPage={() => {}}
            onMovePage={() => {}}
            onDeletePage={() => {}}
            onRenameActivePage={() => {}}
            onUpdatePageConfig={() => {}}
          />
          <DataPanel
            active={false}
            sources={[]}
            availableSources={[]}
            onCreateSource={() => {}}
            onEditSource={() => {}}
            onRemoveSource={() => {}}
          />
          <ImagesPanel
            active={false}
            assets={[]}
            assetUrls={{}}
            uploadingAsset={false}
            onTriggerUpload={() => {}}
            onInsertImageBlock={() => {}}
          />
        </LeftRail>
        <Stage
          stageRef={createRef<HTMLDivElement>()}
          pageConfig={layout.page}
          blocks={layout.pages[0].blocks}
          zoom={0.85}
          showGrid
          selectedBlockId="b1"
          draggingBlockId={null}
          sources={[]}
          assets={[]}
          assetUrls={{}}
          availableSources={[]}
          localDatasets={new Map()}
          reportName="Relatório Assistencial"
          showSampleData
          onClearSelection={() => {}}
          onSelectBlock={() => {}}
          onStartDrag={() => {}}
          onStartResize={() => {}}
        />
        <Inspector
          rightOpen
          selectedBlock={block}
          activePage={layout.pages[0]}
          inspectorTab="content"
          pageConfig={layout.page}
          sources={[]}
          assets={[]}
          uploadingAsset={false}
          knownColumns={["Mes", "Total"]}
          resolveKnownColumns={() => ["Mes", "Total"]}
          onSelectBlock={() => {}}
          onChangeTab={() => {}}
          onReorderLayer={() => {}}
          onDuplicateBlock={() => {}}
          onRemoveBlock={() => {}}
          onTriggerImageUpload={() => {}}
          onOpenCreateSource={() => {}}
          onColumnWidthsValidation={() => {}}
          onUpdateBlock={() => {}}
        />
      </div>,
    );

    expect(workspaceHtml).toContain("Canvas ativo · Alterações não salvas");
    expect(workspaceHtml).toContain("rc-component-tile");
    expect(workspaceHtml).toContain("rc-column-grid");
    expect(workspaceHtml).toContain("rc-block rc-block-kpi is-selected");
    expect(workspaceHtml).toContain("rc-resize-handle-se");
    expect(workspaceHtml).toContain("rc-inspector-tabs");
  });
});
