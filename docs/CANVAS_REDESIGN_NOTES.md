# Notas do Redesign do Canvas de Relatórios (`feature/canvas-redesign`)

Registro técnico iniciado na **Tarefa 01** (fundação, staging, tokens, store com histórico e modularização sem mudança de comportamento).

---

## 1. Diagnóstico do `canvas-check` no baseline (`canvas-baseline` / `d1e57bf`)

Na primeira execução de referência (`/tmp/canvas-check-baseline.log`, duração total ~98 s):
- `npm ci`: OK (10 s)
- `tsc -b`: OK (63 s)
- `vite build`: OK (10 s)
- `vitest run`: **FALHOU** (12 s — 14 arquivos passaram, 2 falharam; os 4 arquivos de teste do Canvas passaram: `canvasSampleData.test.ts`, `canvasParameters.test.ts`, `canvasRoutes.test.ts`, `canvasTablePreview.test.tsx`).

### Testes que falharam no baseline
1. `src/format.test.ts` → `indicadores e horários > apresenta horário de Brasília independentemente do computador` (`Error: Test timed out in 5000ms`, ~8450 ms).
2. `src/groups.test.ts` → `group navigation and schedule > converts Brasilia time without depending on browser timezone` (`Error: Test timed out in 5000ms`, ~8364 ms).

### Causa raiz e ajuste no script de verificação
- Sem limitação de concorrência, o Vitest abria **16 workers isolados simultaneamente** dentro de `node:24-bookworm-slim` disputando CPU do host. Sob carga, a primeira chamada a `new Intl.DateTimeFormat(..., { timeZone: "America/Sao_Paulo" })` em cada worker ultrapassava o timeout padrão de 5000 ms (em execução isolada leva ~34 ms).
- Os arquivos `src/format.ts`, `src/format.test.ts` e `src/groups.test.ts` **não pertencem a esta tarefa e não foram alterados**.
- Em `scripts/canvas-check.sh`, foi definido `VITEST_DEFAULT_ARGS="--maxWorkers=4 --testTimeout=15000"`, eliminando a contenção de CPU. Com isso, 100% da suíte passa de forma determinística e o tempo total de `scripts/canvas-check.sh` caiu de ~98 s para ~40 s.

---

## 2. Pontos observados durante a modularização (não alterados na Tarefa 01)

Conforme a regra da Tarefa 01 (*"Nenhuma lógica nova de produto. Se encontrar bug evidente, anote em `docs/CANVAS_REDESIGN_NOTES.md` e não corrija aqui"*), os seguintes pontos foram mantidos idênticos ao baseline para tratamento nas próximas tarefas:

1. **Divergência entre a paleta de gráficos do editor e a do PDF**
   - Em `frontend/src/components/report-canvas/model.ts` (`SERIES_PALETTE`) e `blocks/ChartPreview.tsx`, o preview usa tons predominantemente azuis (`#075b94`, `#14b4cb`, `#0f766e`, `#2563eb`, `#0369a1`, `#64748b`) precedidos por `options.color`, divergindo de `PALETTE` em `backend/operations/report_canvas/pdf.py` quando `options.series_colors` não está definido.

2. **Whitelist de chaves em `normalizeLayout` e `sanitizeLayoutForApi` (`model.ts`)**
   - Atualmente `normalizeLayout` e `sanitizeLayoutForApi` reconstroem `options` e `sources` copiando apenas o conjunto legado de propriedades (`column_widths`, `color`, `font_size`, `aggregate`, `precision`, `x_field`, `value_field`, `y_fields`, `columns`).
   - As próximas tarefas do front (Tarefas 04, 05 e 07) devem estender `BlockOptions`, `normalizeLayout` e `sanitizeLayoutForApi` para preservar os novos campos opcionais introduzidos no backend (ex.: agrupamento de datas, agregação em gráficos, `series_colors`), garantindo que abrir e salvar um layout não descarte extensões opcionais de `schema_version: 1`.

3. **Vínculo de `source_id` em blocos de texto com `{{fonte.coluna}}`**
   - `TextPreview.tsx` suporta interpolar `{{id_da_fonte.coluna}}` com dados de exemplo e `sanitizeLayoutForApi` preserva `source_id` em blocos `text` quando já presente no JSON, mas o inspetor (`BlockInspector.tsx`) oculta `DataFields` quando `block.type === "text"`, não oferecendo seletor visual de `source_id` para blocos de texto novos.

4. **Validação de `column_widths` atrelada apenas ao `selectedBlockId` atual**
   - Em `DataFields.tsx` / `useCanvasSession.ts`, o erro de `Larguras das colunas` (`onBlur`) grava `columnWidthsErrorRef.current = block.id`, mas `handleSaveCanvas` só bloqueia o salvamento se `columnWidthsErrorRef.current === selectedBlockId`. Se o usuário trocar a seleção antes de clicar em "Salvar", o bloqueio não dispara e `sanitizeLayoutForApi` filtra silenciosamente valores fora de `1..3000`.

5. **Cópia rasa de arrays de `options` ao duplicar bloco**
   - Em `duplicateBlockInLayout` (`stage/geometry.ts`, extraído fielmente do baseline), `options: block.options ? { ...block.options } : undefined` faz cópia rasa dos arrays `y_fields`, `columns` e `column_widths`. Não causa mutação hoje porque os handlers recriam arrays, mas convém clonar arrays explicitamente nas tarefas seguintes.
