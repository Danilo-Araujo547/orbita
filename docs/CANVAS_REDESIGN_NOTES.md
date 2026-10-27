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


---

## 3. Tarefa 08 — QA e endurecimento (27/10/2026)

Trabalho exclusivamente por SSH em SCV-APP03, `/opt/orbita`, branch
`feature/canvas-redesign`. Sem deploy de produção, push, stash, migrations,
leitura de credenciais ou alteração de login/runtime. Staging reconstruído somente
por `scripts/canvas-stage.sh up`, em `127.0.0.1:8091`.

### Alterações e decisões

- Regressão estrutural com 185 layouts reais anonimizados em
  `frontend/src/__fixtures__/canvas/stored-layouts.anonymous.json`.
  IDs, títulos, textos, colunas, parâmetros e células foram substituídos; não há
  dados de prévia nem nomes de relatórios/unidades nessas fixtures.
- Corrigida a perda de títulos vazios, opções vazias, campos opcionais e nomes de
  coluna com espaços no ciclo normalizar/sanear. Ausência de defaults permanece
  ausente; `export_format` existente é preservado. Casas decimais e caixa das cores
  válidas também são preservadas. O teste legado de geometria foi ajustado apenas
  para a correção intencional de preservação de `title: ""`; o teste do inspetor também passou a exigir preservação da caixa das cores.
- Pizza legada no editor agora ignora `options.color`, como o PDF; barras/linhas mantêm a primeira série customizada e `series_colors` explícito prevalece. Teste específico adicionado sem alterar o exportador.
- Colagem/importação acima de 2.000 linhas ou 100 colunas agora rejeita toda a
  operação com erro inline. Antes truncava silenciosamente. Cabeçalhos de até
  100 caracteres e duplicados com sufixos respeitam o limite.
- Datas impossíveis, formatos fora de ISO e horas/fusos inválidos são rejeitados.
  O calendário de strings ISO usa UTC no front para evitar DST/fuso do navegador,
  conservando o dia escrito como no backend. Semanas começam segunda-feira.
- Overflow de agregação e números não finitos são rejeitados com erro específico;
  média de valores grandes divide antes de somar. JSON malformado deixa de causar
  TypeError/500 por listas/objetos usados como tipo, agregação ou referência.
- Prévia valida a fonte antes de consultar; logs/respostas de falhas inesperadas
  não incluem exceções de conexão. Audit de prévia tem apenas metadados.
- Cache de prévia agora é separado por unidade/relatório, limitado a 30 entradas
  e limpo ao desmontar o editor. Prévia consultada não vai para localStorage;
  tabelas manuais continuam sendo parte do layout. Rascunho corrompido/storage
  bloqueado falha sem derrubar a tela.
- Tab volta a seguir a ordem nativa de foco. Antes havia captura global que
  prendia a seleção nos blocos e impedia percorrer controles. Ctrl+S não salva o
  formulário ao fundo de um modal; botões internos do bloco não iniciam arraste.
- Editor carregado por `React.lazy`/`Suspense` na fronteira limpa de
  `ReportCanvasPage.tsx`; o `App.tsx` já estava alterado por terceiros e foi preservado.
- Rota `canvas_source_preview` confirmada como usada pelo front/testes; o arquivo
  previamente não rastreado `backend/operations/report_api.py` foi commitado sozinho,
  conforme autorização extra, em `289af78`.

### Regressão em banco real, somente leitura

`scripts/canvas-audit-layouts.py` foi executado no container de testes com
`PGOPTIONS="-c default_transaction_read_only=on"` e transação `READ ONLY`.
O perfil de testes aponta por padrão para uma base indisponível para shell;
a conexão de inventário recebeu explicitamente o nome da base existente, sem
ler ou imprimir credenciais. Nenhum registro foi salvo.

- **185/185** layouts existentes aceitos por `validate_layout`.
- **185/185** fixtures anonimizadas passam em igualdade JSON após
  `normalizeLayout → sanitizeLayoutForApi`, sem inclusão de extensões ausentes.
- `canvas-baseline` (`d1e57bf`) foi aberto em worktree destacado temporário
  `/tmp/orbita-canvas-task08-baseline`, nunca dentro de `/opt/orbita`.
- `scripts/canvas-compare-baseline.py` monta o pacote baseline em `/baseline:ro`.
  Consulta cada fonte uma vez por layout e fornece o mesmo snapshot em memória
  aos dois motores, eliminando diferenças por mudanças simultâneas dos dados.
  Não grava arquivos exportados, dados consultados, jobs ou Audit.
- Primeira comparação: **150 PDFs e 150 XLSX equivalentes; zero diferenças**.
  PDF usa `invariant=1` para congelar ID/data de criação; XLSX compara cada entrada
  do ZIP, removendo apenas datas `created/modified` de `docProps/core.xml`.
  Não se afirma igualdade de bytes de timestamps variáveis de arquivos normais.
- **35 layouts bloqueados** sem parâmetros apropriados: segunda execução confirma
  a mesma `ValidationError` no baseline e no código atual (34 por parâmetros,
  um por outra validação existente). Seus exports ainda exigem parâmetros válidos;
  não foram inventados valores operacionais para forçar a execução.
- Repetição sob carga: 150 PDFs e 146 XLSX equivalentes; quatro XLSX atingiram o
  time-box de 25 s do auditor (ordinais anônimos 6, 7, 8 e 30), sem diferença de
  conteúdo demonstrada. A primeira execução desses quatro passou.

Reprodução (nome do banco informado explicitamente; saída contém só metadados):

```sh
git worktree add --detach /tmp/orbita-canvas-task08-baseline canvas-baseline
docker compose --profile test run --rm -T \
  -e PGOPTIONS="-c default_transaction_read_only=on" \
  tests python - NOME_DO_BANCO < scripts/canvas-audit-layouts.py
# Para regenerar fixtures, revisar a anonimização antes de gravar/commitar saída.
docker compose --profile test run --rm -T \
  -v /tmp/orbita-canvas-task08-baseline/backend/operations/report_canvas:/baseline:ro \
  -e PGOPTIONS="-c default_transaction_read_only=on" \
  tests python - NOME_DO_BANCO < scripts/canvas-compare-baseline.py
git worktree remove /tmp/orbita-canvas-task08-baseline
```

### Matriz de casos extremos

“Falha / pendente” indica falta de comprovação ou limitação aberta, não um teste
aprovado. Nenhum teste de salvamento usa relatório real de staging.

| Caso | Resultado | Evidência / limite |
|---|---|---|
| 100 blocos, 30 páginas, 30 fontes; tentativa de exceder | OK | pytest de fronteira, rejeição dos excedentes |
| 20 imagens; tentativa de 21ª | OK | pytest com uploads no banco isolado |
| Layout próximo de 750 KB e excedente | Corrigido | pytest; erro informa 750 KB; mesmo JSON compacto UTF-8 do front |
| Tabela 100 colunas × 2.000 linhas | OK | vitest de importação e pytest de fonte/layout (zeros); conteúdo pode exceder 750 KB |
| Colar 5.000 linhas / 101 colunas | Corrigido | vitest rejeita; modal captura erro e preserva tabela anterior |
| Colunas com acentos, espaços, 100 caracteres, duplicados | Corrigido | vitest/pytest; importação desambigua; JSON duplicado rejeita |
| Gráficos 0, 1, 500 e 501 pontos | OK | pytest; 501 rejeitado; testes existentes de limite após agrupamento |
| Séries null, zero, negativos em pizza | OK | pytest e testes de agrupamento existentes |
| Números enormes, NaN, Infinity e overflow da soma | Corrigido | pytest/vitest; média de 1e308 mantém valor finito |
| Datas inválidas/nulas, fuso/horas, 29/02 | Corrigido | pytest/vitest; contrato ISO estrito e dia escrito preservado |
| Virada de ano, semana 53, texto parecido com data | OK | pytest/vitest, sem conversão de texto arbitrário |
| Fonte removida/renomeada com vínculos | OK | testes existentes de sourceOps e histórico |
| Relatório de origem desativado/outra unidade | OK | pytest de rejeição; relatório estrangeiro 404 |
| Usuário sem admin na prévia | OK | pytest: 403 antes de consultar |
| Conflito 409 ao salvar | OK | request mockado no vitest e pytest existente; nenhum save real |
| 401 durante prévia / API fora do ar | OK | vitest do cliente: rejeição propagada; sessão real expirada permanece pendente |
| Endpoint de prévia ausente | OK | vitest de 404/405 e fallback indisponível; servidor antigo real pendente |
| Troca de tipo/fonte com undo/redo encadeado | OK | novo teste de reducer e testes existentes de operações |
| Undo após salvar | OK | teste verifica revisão suja e redo até revisão salva |
| Salvar rascunho com colunas faltando / ativar com erros | OK | testes existentes de draft permissivo e validate_complete; referências inválidas continuam bloqueadas |
| PNG/JPEG, 16 MP e acima; corrompido | OK | pytest de uploads; 16 MP aceita, excedente/corrompido rejeita |
| PNG com exatamente 2 MiB e acima | OK | pytest; PNG válido preenchido até limite; excedente rejeitado |
| Nome de imagem com caracteres especiais/caminho | OK | pytest preserva acentos, elimina caminho |
| Excluir imagem usada | Falha / pendente | remoção na biblioteca é local, não DELETE no servidor; conferir vínculo e undo manualmente |
| Variável inexistente, HTML/script literal | OK | SSR vitest e conteúdo PDF/XLSX em pytest |
| Emoji, 20.000 caracteres, quebras PDF/XLSX | Falha / parcial | limite e texto literal/quebras testados; Unicode XLSX testado; glifo emoji PDF não garantido |
| Redimensionar janela durante arraste | Falha / pendente | requer observação visual de continuidade/posição |
| Zoom 25%/200%, páginas 150/3000, blocos 20 | Falha / parcial | geometria/limites em pytest e testes existentes; combinação visual extrema pendente |
| Teclado completo; atalhos com foco em inputs | Corrigido / parcial | removido trap global de Tab; cobertura assistiva completa pendente |
| aria-live, nomes acessíveis e leitor de tela | Falha / parcial | status polite/names revisados; leitor de tela real pendente |
| prefers-reduced-motion; navegador 200% | Falha / parcial | media query existente; verificação assistiva/zoom real pendente |
| Sem long task >100 ms durante arraste | Falha / pendente | 100 gráficos falhou no primeiro perfil; smoke final de 1 gráfico passou; perfil final de 100 pendente |
| Um BlockFrame por pointermove | Falha / parcial | vitest prova uma invalidação de memo em 100; não substitui contador real de renders |
| computeProblems/prévias memoizados; ObjectURLs | Falha / parcial | useMemo e limpeza em useAssetUrls revisados; perfil de heap sustentado pendente |
| XSS/eval/segredos/cache/Audit | Corrigido | sem eval/dangerouslySetInnerHTML no Canvas; HTML literal, logs redigidos e cache isolado testados |
| Axe/contraste AA nos dois temas, foco, alvos 24 px | Corrigido / parcial | contraste do selo numérico corrigido; smoke axe verde nos dois temas; auditoria humana/foco/alvos pendente |

### Verificações, performance e acessibilidade

Primeira execução Playwright 1.56.1 / axe 4.11.0, Chromium headless, container
próprio com limite de 2 CPUs/1.5 GiB: **100 blocos × 500 pontos**, nenhum erro de
console, nenhuma escrita tentada, sem overflow horizontal a 1100 px e status
`aria-live="polite"` presente. Tab saiu do último BlockFrame (para SVG do gráfico),
sem o trap global. Axe: tema escuro sem violações WCAG A/AA detectadas nesse
cenário; tema claro com **1 ocorrência séria de color-contrast**.

Durante a interação de arraste foram registradas long tasks de **162, 123, 134,
220 e 619 ms**: o orçamento de 100 ms **falhou** nessa execução. MutationObserver
mostrou mudança no DOM de **um bloco**, não uma contagem real de renders React.
Após essa evidência o arraste foi alterado para `translate3d` com promoção temporária
da camada e contenção de layout/pintura do conteúdo, preservando os badges externos.
A segunda medição registrou 108 e 209 ms, mas ocorreu antes de confirmar o
bundle servido; não é usada para atribuir ganho à implementação final.
O nó de contraste era `.num`, selo de coluna numérica: `#0f7f73` sobre `#e2f0ee`,
4,16:1. O fundo passou para `var(--cv-surface)`, preservando a cor do token.

Após aguardar o rebuild e verificar que o CSS servido contém `contain:layout paint`,
o smoke com **1 gráfico × 500 pontos** confirmou `transform: matrix(...)`, contenção
ativa, **zero long tasks >100 ms**, **zero violações axe nos dois temas**, nenhum
erro de console ou escrita tentada, sem overflow a 1100 px e status polite presente.
Isso valida a correção de contraste nesse cenário; **o perfil final com 100 gráficos
não foi repetido após confirmar o bundle novo**, portanto o orçamento de carga segue
pendente. Leitor de tela, zoom real 200%, ordem completa de foco e alvos não são
certificados pelo axe desse smoke.

O harness usa somente dados/sessão sintéticos e bloqueia todos os métodos de API
diferentes de GET. Nenhum login real é realizado. Isso não prova ausência de erro
em uso autenticado real. Objetos de dados/arquivos sensíveis não são capturados.

Antes do lazy-load, `canvas-check` produzia JS inicial de **859,15 KB**
(**243,42 KB gzip**) e `charts` de **427,88 KB** (**123,15 KB gzip**).
Após dividir: JS inicial **591,04 KB** (**166,70 KB gzip**, delta **−268,11 KB**),
editor **270,76 KB** (**78,59 KB gzip**) e charts sem aumento.
CSS inicial 284,83 → 221,49 KB; editor CSS 63,39 KB sob demanda.
O aviso Vite de chunk inicial acima de 500 KB permanece; não foi ocultado.
Isso é delta da árvore recebida da Tarefa 07 para a Tarefa 08, não um build
completo do baseline original, que não contém os módulos não rastreados do ambiente.

### Testes e arquivos

- Antes das alterações: `canvas-check` verde; backend completo **845 passed, 1 failed**.
- Backend completo após endurecimento: **895 passed, 1 failed**, 377,66 s.
  A única falha é a mesma pré-existente:
  `tests/test_recipient_manual_reports.py::test_search_is_lazy_paginated_and_excludes_components_and_other_units`
  (espera 50 resultados, retorna 25). Nenhum teste Canvas falhou nessa suíte.
- Execução direcionada Canvas intermediária: **120 passed**, 48,21 s; os seis
  testes adicionais de serialização não finita passaram depois na suíte completa.
- Front: `scripts/canvas-check.sh` executa tsc, Vitest e Vite em Node 24/Docker.
  A execução antes do último teste de paleta passou com **419 testes / 29 arquivos**;
  a execução final com o caso de paleta passou com **420 testes / 29 arquivos**,
  tsc e build verdes, 58 s. JS do editor: **270,76 KB / 78,59 KB gzip**.
- `git diff --cached --check` aplicado a cada commit; erros de whitespace já existentes
  em `frontend/src/reports.css` fora do escopo foram preservados.

Arquivos alterados: modelo/normalização, importação e painel de dados, cliente de
prévia/cache, recuperação local e teclado em `frontend/src/components/report-canvas/`;
`ReportCanvas.tsx`, `ReportCanvasPage.tsx`; testes do Canvas e fixtures anonimizadas;
`api.py`, `schema.py`, `sources.py`, `blocks.py` do backend Canvas; a rota autorizada
em `backend/operations/report_api.py`; três scripts de auditoria/QA e estes três
arquivos `CANVAS_*.md`. Nenhum arquivo de login/runtime ou de terceiros foi incluído.

Para repetir o harness (container próprio, projeto somente leitura; instalação
acontece dentro do container descartável):

```sh
docker run --rm --name orbita-canvas-stage-qa --network host \
  --cpus=2 --memory=2500m -v /opt/orbita:/work:ro -w /qa \
  -e NODE_PATH=/qa/node_modules -e CANVAS_QA_BLOCKS=100 \
  node:24-bookworm-slim bash -c 'npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.56.1 @axe-core/playwright@4.11.0 && npx playwright install --with-deps chromium && node /work/scripts/canvas-stage-qa.cjs'
```

Omitir `CANVAS_QA_BLOCKS=100` roda o smoke de um gráfico. Consultas e sessão da API
são mockadas, inclusive nesse perfil completo; não há login real nem Salvamento.

### Ajuda existente e documentação

Guia curto: [CANVAS_EDITOR.md](CANVAS_EDITOR.md). Contrato:
[CANVAS_API.md](CANVAS_API.md).
A ajuda atual da aplicação é `/guia.html?tela=<page>`, alimentada por
`frontend/public/guia.js`. No Canvas, `App.tsx` retorna `ReportCanvasPage` antes
de renderizar a barra lateral: não existe ali botão de ajuda lateral para redirecionar.
`App.tsx`, `guia.js` e `guia.html` tinham alterações de terceiros e foram preservados.
Não foi criada navegação paralela; ligação contextual da documentação do Canvas
fica pendente quando esse mecanismo for integrado à tela.

### Pendências priorizadas

1. **P1 — exports dependentes de parâmetros:** validar os 35 layouts bloqueados
   com parâmetros operacionais adequados, em leitura, antes de declarar regressão
   zero para todos os exports reais. Não houve diferença nas amostras geradas.
2. **P1 — prévia de fonte na folha:** `selectLocalDatasets` usa inline/metas;
   prévias consultadas de relatórios ficam no painel de Dados/cache e o preview
   de gráfico de relatório mantém placeholder fora do modo Exemplo. Verificar e
   completar a ligação reativa entre cache/folha sem confundir exemplo com dado real.
3. **P1 — acessibilidade/perfil completos:** contraste corrigido e smoke axe verde; o orçamento de 100 ms falhou no primeiro perfil de 100 gráficos e precisa ser repetido com o bundle final. Concluir alvos/foco,
   leitor de tela e medição real de renders/long tasks conforme evidências acima. Handles visuais de resize têm 8 px na implementação existente; alvo físico mínimo de 24 px não está comprovado nos zooms extremos.
4. **P2 — XLSX:** `series_colors` não configura cores dos gráficos nativos (estilo
   legado 13); PDF/editor respeitam cores explícitas. Documentação corrigida para
   não prometer paridade de paleta XLSX ainda inexistente.
5. **P2 — Unicode PDF:** Helvetica legada pode não cobrir emoji; conferir arquivo
   real antes de depender desses caracteres. Não foi trocada a fonte legada porque
   isso alteraria a exportação de todos os relatórios.
6. **P2 — carga:** quatro XLSX excederam 25 s na repetição concorrente. Repetir
   isoladamente e medir volume/tempo antes de definir orçamento de exportação.
7. **P2 — ajuda contextual:** integrar `CANVAS_EDITOR.md` ao mecanismo existente
   quando a área proprietária dos arquivos da ajuda estiver liberada.
8. **Fora do Canvas:** teste de paginação de relatórios manuais já falhava antes
   das alterações desta tarefa; separado nos resultados, sem correção fora de escopo.

### Implantar e reverter (procedimento, não executado)

1. Revisar os commits locais e pendências, especialmente fontes/permissões e
   regressão dos exports ainda bloqueados. Preservar login e configuração cifrada.
2. Fazer backup verificável do banco/layouts e registrar a revisão implantada.
   Integrar **backend/API primeiro**, incluindo a rota de prévia, e realizar restart
   controlado pelo operador autorizado. Não há migrations desta tarefa.
3. Validar 403/404 por unidade/perfil e prévia sem efeitos colaterais. Só então
   reconstruir/publicar o painel e conferir login, chunks lazy e HTTP.
4. Reverter por commits com `git revert <hash>` na ordem inversa, revisando conflitos
   e preservando alterações de terceiros. Reverter o frontend junto se a API voltar
   a versão sem a rota; o fallback de prévia trata 404/405.
5. Para reversão total do redesign, usar `canvas-baseline` (`d1e57bf`) como referência
   em worktree separado e reverter os commits Canvas da branch em ordem inversa,
   depois repetir a ordem backend → painel e as verificações. Não usar reset/checkout
   destrutivos na árvore compartilhada e não mudar para baseline em produção sem
   revisão dos demais módulos/runtime. Os layouts continuam em schema_version 1.

Nenhuma ação de implantação/reversão foi executada por esta tarefa.


### Commits locais e encerramento

| Commit | Conteúdo |
|---|---|
| `289af78` | Rota de prévia: somente `backend/operations/report_api.py` |
| `38fe670` | Testes, fixtures anonimizadas, inventário e comparação baseline, harness |
| `21189c3` | Round-trip, validação, datas, números, logs, cache, rascunho e teclado |
| `29f2e19` | Lazy-load e arraste por transformação/contenção |
| `0cf0b75` | Contraste numérico, colagem de coluna única e descarte de resposta tardia |
| `b21f70a` | Paleta legada de pizza igual ao PDF |

A documentação é o commit seguinte a estes; consultar `git log --oneline` para
seu hash. Para desfazer somente esta tarefa, revisar e reverter essa sequência
em ordem inversa, incluindo documentação. Para o redesign inteiro, incluir também
os commits anteriores à Tarefa 08 desde `canvas-baseline`, conforme procedimento.

Verificação final: staging ativo em `127.0.0.1:8091`, HTTP **200**. Worktree temporário
do baseline removido; container auxiliar QA removido. Produção, login, credenciais,
configuração runtime e alterações de terceiros preservados. Nenhum push executado.

**Aceite integral pendente** pelos itens P1/P2 acima. Não declarar cobertura de todos
os exports reais nem performance de 100 gráficos/leitor de tela com base no smoke.
