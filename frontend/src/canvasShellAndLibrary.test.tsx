import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BlockLibrary from "./components/report-canvas/library/BlockLibrary";
import ImagesPanel from "./components/report-canvas/library/ImagesPanel";
import PagesPanel from "./components/report-canvas/library/PagesPanel";
import {
  computePageDropPosition,
  computeVisibleCenterPosition,
  duplicatePageInLayout,
} from "./components/report-canvas/library/structureOps";
import { createDefaultLayout } from "./components/report-canvas/model";
import Banner from "./components/report-canvas/shell/Banner";
import LeftRail from "./components/report-canvas/shell/LeftRail";
import StatusBar from "./components/report-canvas/shell/StatusBar";
import TopBar from "./components/report-canvas/shell/TopBar";
import {
  computeCanvasProblems,
  describeBlockDisplayName,
  describeBlockLineage,
} from "./components/report-canvas/shell/problems";
import { clampPanelWidth } from "./components/report-canvas/shell/useShellLayoutPrefs";
import { computeLimits } from "./components/report-canvas/state/limits";

describe("Shell do editor — TopBar, LeftRail, painéis, StatusBar e Banner", () => {
  it("renderiza TopBar em modo Rascunho sem badge de Problemas quando problemCount = 0", () => {
    const html = renderToStaticMarkup(
      <TopBar
        reportName="Produção Ambulatorial"
        version={3}
        enabled={false}
        outputFormat="pdf"
        dirty={false}
        loading={false}
        busy={false}
        canUndo={false}
        canRedo={true}
        undoLabel={null}
        redoLabel="Inserir tabela"
        zoom={1}
        onChangeZoom={() => {}}
        onFitToWidth={() => {}}
        problemCount={0}
        problemSeverity={null}
        dataMode="preview"
        onChangeDataMode={() => {}}
        onChangeEnabled={() => {}}
        onChangeOutputFormat={() => {}}
        onOpenPreview={() => {}}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('role="toolbar"');
    expect(html).toContain("Relatórios");
    expect(html).toContain("Produção Ambulatorial");
    expect(html).toContain("Rascunho");
    expect(html).toContain("v3");
    expect(html).toContain("Refazer: Inserir tabela (Ctrl+Shift+Z)");
    expect(html).toContain("100 %");
    expect(html).not.toContain("cv-problems-btn");
    expect(html).not.toContain("cv-unsaved-dot");
    expect(html).toContain("Publicação");
    expect(html).toContain("Prévia");
    expect(html).toContain("Salvar");
  });

  it("renderiza LeftRail vertical com 4 abas rotuladas e BlockLibrary em lista densa sem cartões", () => {
    const html = renderToStaticMarkup(
      <LeftRail
        leftOpen
        libraryTab="components"
        onSelectLibrary={() => {}}
        onCloseLeftPanel={() => {}}
      >
        <BlockLibrary active loading={false} onAddComponent={() => {}} onClosePanel={() => {}} />
      </LeftRail>,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain("Adicionar");
    expect(html).toContain("Estrutura");
    expect(html).toContain("Dados");
    expect(html).toContain("Imagens");
    expect(html).toContain("Número com agregação");
    expect(html).toContain("Colunas da fonte em tabela");
    expect(html).not.toContain("rc-component-grid");
  });

  it("renderiza PagesPanel com árvore de blocos (linhagem fonte › coluna, problemas e camadas)", () => {
    const layout = createDefaultLayout();
    layout.sources.push({
      id: "src_atend",
      type: "inline",
      label: "Atendimentos",
      columns: ["especialidade", "total"],
      rows: [["Clínica", 42]],
    });
    layout.pages[0].blocks.push(
      {
        id: "b_bar",
        type: "bar",
        x: 32,
        y: 80,
        width: 480,
        height: 240,
        source_id: "src_atend",
        options: { x_field: "especialidade", y_fields: ["total"] },
      },
      {
        id: "b_kpi_broken",
        type: "kpi",
        x: 32,
        y: 340,
        width: 220,
        height: 120,
        title: "Taxa de Ocupação",
      },
    );

    const problems = computeCanvasProblems({
      layout,
      enabled: true,
      availableSources: [],
    });

    expect(problems.count).toBe(1);
    expect(problems.highestSeverity).toBe("error");
    expect(describeBlockDisplayName(layout.pages[0].blocks[0])).toBe("Gráfico de barras");
    expect(describeBlockLineage(layout.pages[0].blocks[0], layout.sources)).toBe(
      "Atendimentos › especialidade, total",
    );

    const html = renderToStaticMarkup(
      <PagesPanel
        active
        pages={layout.pages}
        activePage={layout.pages[0]}
        pageConfig={layout.page}
        selectedBlockId="b_bar"
        sources={layout.sources}
        blockProblems={problems.byBlockId}
        onSelectPage={() => {}}
        onSelectBlock={() => {}}
        onAddCoverPage={() => {}}
        onAddBlankPage={() => {}}
        onDuplicatePage={() => {}}
        onMovePage={() => {}}
        onDeletePage={() => {}}
        onRenameActivePage={() => {}}
        onReorderBlock={() => {}}
        onUpdatePageConfig={() => {}}
      />,
    );

    expect(html).toContain("Nova página");
    expect(html).toContain("1/30");
    expect(html).toContain("Gráfico de barras");
    expect(html).toContain("Atendimentos › especialidade, total");
    expect(html).toContain("Taxa de Ocupação");
    expect(html).toContain("cv-block-tree-problem is-error");
    expect(html).toContain("Trazer Gráfico de barras para frente");
    expect(html).toContain("Enviar Taxa de Ocupação para trás");
  });

  it("renderiza ImagesPanel com limite 2/20, uso em blocos e ação contextual no bloco selecionado", () => {
    const layout = createDefaultLayout();
    const usedId = "11111111-2222-3333-4444-555555555555";
    const freeId = "66666666-7777-8888-9999-000000000000";
    layout.pages[0].blocks.push({
      id: "b_img",
      type: "image",
      x: 40,
      y: 40,
      width: 180,
      height: 80,
      asset_id: usedId,
    });

    const html = renderToStaticMarkup(
      <ImagesPanel
        active
        assets={[
          { id: usedId, filename: "logo-ame.png", width: 240, height: 80 },
          { id: freeId, filename: "selo-qualidade.png", width: 120, height: 120 },
        ]}
        assetUrls={{ [usedId]: "blob:mock-1" }}
        uploadingAsset={false}
        pages={layout.pages}
        selectedBlock={layout.pages[0].blocks[0]}
        onTriggerUpload={() => {}}
        onInsertImageBlock={() => {}}
        onUseInSelectedBlock={() => {}}
        onDeleteAsset={() => {}}
      />,
    );

    expect(html).toContain("2/20");
    expect(html).toContain("Enviar imagem");
    expect(html).toContain("240×80 px · usada em 1 bloco");
    expect(html).toContain("120×120 px · usada em 0 blocos");
    expect(html).toContain("Ativa");
    expect(html).toContain("Usar");
  });

  it("duplica páginas com novos IDs de blocos, limita largura de painel (240..400) e calcula posição de inserção", () => {
    expect(clampPanelWidth(180, 288)).toBe(240);
    expect(clampPanelWidth(480, 288)).toBe(400);
    expect(clampPanelWidth(312, 288)).toBe(312);

    const layout = createDefaultLayout();
    layout.pages[0].blocks.push({
      id: "b1",
      type: "text",
      x: 32,
      y: 100,
      width: 540,
      height: 240,
      text: "Cabeçalho",
    });

    const dup = duplicatePageInLayout(layout, "p1");
    expect(dup.ok).toBe(true);
    if (dup.ok) {
      expect(dup.layout.pages).toHaveLength(2);
      expect(dup.layout.pages[1].name).toContain("(cópia)");
      expect(dup.layout.pages[1].blocks[0].id).not.toBe("b1");
      expect(dup.layout.pages[1].blocks[0].text).toBe("Cabeçalho");
    }

    const centered = computeVisibleCenterPosition({
      stageEl: null,
      type: "kpi",
      pageWidth: 794,
      pageHeight: 1123,
      zoom: 0.85,
      blockCountOnPage: 0,
    });
    expect(centered.x).toBeGreaterThanOrEqual(0);
    expect(centered.y).toBeGreaterThanOrEqual(0);

    const dropped = computePageDropPosition({
      stageEl: null,
      clientX: 300,
      clientY: 240,
      type: "table",
      pageWidth: 794,
      pageHeight: 1123,
      zoom: 1,
    });
    expect(dropped.x).toBeGreaterThanOrEqual(0);
  });

  it("renderiza StatusBar com estado de salvamento, v7, coordenadas do bloco e indicador de limites", () => {
    const layout = createDefaultLayout();
    layout.pages[0].blocks.push({
      id: "b1",
      type: "bar",
      x: 32,
      y: 100,
      width: 540,
      height: 240,
    });
    const limits = computeLimits(layout, 17); // 17/20 = 85% -> warning

    const html = renderToStaticMarkup(
      <StatusBar
        dirty
        saving={false}
        version={7}
        selectedBlock={layout.pages[0].blocks[0]}
        limits={limits}
      />,
    );

    expect(html).toContain("Alterações não salvas");
    expect(html).toContain("v7");
    expect(html).toContain("x 32 · y 100 · 540 × 240 px");
    expect(html).toContain("cv-limits-trigger is-warning");
    expect(html).toContain("Limites");
  });

  it("renderiza Banner nos estados ok, error e conflito de versão (v7 → v8)", () => {
    const okHtml = renderToStaticMarkup(
      <Banner
        banner={{ tone: "ok", text: "Rascunho salvo." }}
        disabled={false}
        currentVersion={7}
        onReload={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(okHtml).toContain('role="status"');
    expect(okHtml).toContain("Rascunho salvo.");
    expect(okHtml).toContain("Fechar");

    const errHtml = renderToStaticMarkup(
      <Banner
        banner={{ tone: "error", text: "Falha de comunicação com o servidor." }}
        disabled={false}
        currentVersion={7}
        onReload={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(errHtml).toContain('role="alert"');
    expect(errHtml).toContain("Recarregar");
    expect(errHtml).toContain("Copiar detalhes");
    expect(errHtml).toContain("Fechar");

    const conflictHtml = renderToStaticMarkup(
      <Banner
        banner={{
          tone: "conflict",
          text: "Conflito de versão (409). Recarregue os dados do relatório antes de salvar novamente.",
        }}
        disabled={false}
        currentVersion={7}
        onReload={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(conflictHtml).toContain('role="alert"');
    expect(conflictHtml).toContain("Este relatório foi alterado por outra pessoa (v7 → v8)");
    expect(conflictHtml).toContain("Recarregar (perde alterações)");
    expect(conflictHtml).toContain("Manter minhas alterações");
    expect(conflictHtml).toContain("Copiar detalhes");
  });
});
