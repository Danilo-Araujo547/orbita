# Engine Canvas de relatórios

Implementada em 25/10/2026. Cada ReportDefinition possui um rascunho canvas_layout e a opção canvas_enabled. Abertura pelo botão Canvas na linha do relatório. Não altera automaticamente os relatórios existentes nem suas programações.

## Operação

1. Relatórios: abra Canvas no relatório desejado; exige administrador da unidade.
2. Configure páginas (A4 retrato/paisagem ou tamanho livre), colunas e fundo.
3. Cadastre as fontes necessárias: consulta SQL revisada da unidade, dados manuais ou metas mensais do próprio relatório.
4. Adicione blocos: texto, KPI, tabela, barras, linhas, pizza ou imagem. Posicione e redimensione no Canvas ou nos campos do inspetor. Cada bloco escolhe uma fonte; fontes podem ser reutilizadas.
5. Use páginas com imagem/texto como capa e encerramento. Imagens são arquivos PNG/JPEG anexados ao relatório e servidos por API autenticada, sem URLs externas.
6. Gere uma prévia PDF ou XLSX informando os parâmetros. Prévia não cria envio nem execução na fila; apenas lê as fontes e devolve o arquivo.
7. Salve o rascunho. Marque Usar Canvas somente quando quiser trocar o gerador daquele relatório. A ativação não muda o estado Ativo do relatório nem habilita suas programações. Ao desativar Canvas, são restaurados formato e revisão anteriores.

Metas são configurações mensais do relatório. Não são solicitadas ao destinatário e ficam fotografadas na execução. Fontes SQL devem ser cadastradas/revisadas nos componentes ou relatórios; não há SQL arbitrário dentro de blocos.

## Módulos e plugins

- operations/report_canvas/registry.py: registros SOURCES, BLOCKS e EXPORTERS.
- sources.py: estratégias read(context, spec) -> Dataset(columns, rows); conexões somente leitura, compartilhadas durante a coleta para fontes da mesma conexão.
- blocks.py: estratégias prepare(block, context) -> representação intermediária independente do PDF/XLSX. Seleção de campos, agregação do KPI e validação numérica ficam aqui.
- schema.py: validação do documento schema_version=1, dimensões, limites e referências.
- engine.py: validação das dependências, coleta, preparação e seleção do exportador. Não conhece drivers de gráficos.
- pdf.py: exportador ReportLab, com renderizadores vetoriais registrados por tipo. Tabelas geram páginas de continuação com cabeçalho repetido, sem descartar linhas.
- xlsx.py: exportador OpenPyXL; gráficos nativos do Excel e valores tipados. A posição em pixels é adaptada a uma grade de células. Tabelas que ultrapassam a altura ou a largura do bloco têm abas de dados completos e link na página visual. Séries dos gráficos ficam em abas auxiliares ocultas. Não se promete identidade pixel a pixel entre PDF e Excel.
- api.py: configuração, prévia e imagens; nenhuma chamada ao transporte WhatsApp.

Para um novo bloco, registre um preparador e os renderizadores dos formatos suportados. Para uma nova fonte, implemente validate/read e registre-a em SOURCES. Para novo formato, registre um exportador render(document) -> bytes e amplie a lista pública de formatos/modelo. O orquestrador permanece independente das implementações.

## Fontes e parâmetros

Fonte report: {id, type: "report", report_id, parameters: {}}. Referencia SQL SELECT existente, revisado, habilitado e com conexão válida da mesma unidade. Parâmetros por fonte são padrões; restrições e parâmetros de execução têm precedência quando usam o mesmo nome. Para nomes diferentes, parameters pode conter {"inicio": {"parameter": "data_inicial"}}. As datas continuam vinculadas por bind; não há concatenação em SQL.

Fonte inline: {id, type: "inline", columns: ["Mês", "Total"], rows: [["Jan", 10]]}. Fonte goals: {id, type: "goals"}, colunas year, month e value.

Textos podem usar {{report_name}} e parâmetros nomeados, por exemplo {{data_referencia}}. Não há execução de HTML/JavaScript no servidor. KPI: sum, count ou first; ausência de dados não vira zero automaticamente.

## API

- GET/POST /api/v1/reports/{id}/canvas/?unit=...: layout, versão, ativação e formato; POST requer Idempotency-Key e versão atual. Conflito retorna 409.
- POST /api/v1/reports/{id}/canvas-preview/?unit=...: layout, parameters e output_format; retorna content base64, format, rows e filename. Nenhum envio.
- GET/POST /api/v1/reports/{id}/canvas-assets/?unit=...: metadados/upload; POST com filename e content base64 puro, com idempotência. GET com asset_id retorna uma imagem autenticada do próprio relatório.

A geração habitual continua via report-executions e suas permissões já existentes. Quando Canvas está ativo, make_execution registra layout, dependências de SQL/conexão, hashes das imagens e metas. O acesso é revalidado antes e depois da geração e antes do download/entrega. Mudanças de definição/fonte invalidam execuções antigas conforme a política vigente. A imagem é imutável; substituição cria outro identificador.

## Limites e proteção

30 páginas declaradas, 100 blocos, 30 fontes; fonte manual até 2.000 linhas e 100 colunas; consulta respeita limite/timeout da conexão; coleta total até 30.000 linhas e 10 MB; gráficos até 500 pontos e 6 séries; PDF até 200 páginas incluindo continuações; arquivo final até 7 MB. Upload de até 2 MB, PNG/JPEG e 16 megapixels, reencodificado PNG; até 20 imagens por relatório. Sem caminhos livres, SVG ou download externo de imagens. Textos são escapados; strings iniciadas por = permanecem texto no XLSX.

Alterações de configuração e prévias são auditadas por unidade/autor. Logs não imprimem resultados de consultas, senhas ou arquivos. A engine não faz consulta nova ao abrir o editor: apenas prévia/execução lê fontes. Fontes pendentes continuam desabilitadas. Metadados de conexões e credenciais existentes são preservados.

## Validação

Testes em tests/test_report_canvas.py cobrem PDF/XLSX, gráficos nativos, tabelas de continuação, fórmulas como texto, fontes SQL/metas, parametrização, revisão das dependências, imagens, isolamento, acesso administrativo, idempotência/versão e prévia sem enfileiramento. Regressões existentes dos relatórios são executadas antes da publicação. Não há envio de mensagens reais nos testes.

## Editor visual

A implementação do editor foi produzida com o Gemini 4 Argon via Agy local e revisada antes da integração. O modelo, os contratos e a normalização ficam em frontend/src/components/report-canvas/model.ts. A prévia de cada bloco fica em BlockPreview.tsx, isolada e memoizada; mover um bloco não redesenha o conteúdo dos demais gráficos. ReportCanvas.tsx coordena ferramentas, fontes, páginas e inspetor; report-canvas.css contém estilos restritos ao editor.

Números e datas vindos das fontes SQL são preservados com tipos para a exportação XLSX. As consultas antigas continuam recebendo strings como antes: a opção typed é usada apenas pelo adaptador SQL do Canvas. Datas são exibidas em DD/MM/AAAA.

## Publicação e conferência — 25/10/2026

Publicado no servidor 172.16.0.59, com migration 0027 aplicada. API, worker, scheduler e painel atualizados. Backup anterior em /opt/backups/orbita/canvas-engine-20261025/database-before-canvas.dump. Regressão ampliada: 213 testes aprovados; após ajuste adicional de compatibilidade dos parâmetros legados, suíte Canvas: 21 aprovados. Build TypeScript/Vite aprovado.

Validação autenticada no navegador: fonte de metas mensais, bloco tabela, ajuste de título/tamanho, salvamento com versão e prévias PDF/XLSX com 24 linhas. Rascunho no relatório legacy123-310 (ID 309), versão 3; canvas_enabled permanece false e relatório permanece desativado. Não houve alteração das programações ou acionamento de envio. A prévia do editor limita visualmente as linhas; os exportadores incluem os dados completos, conforme limites documentados.

### Revisão visual do editor

Barra de ferramentas compacta, formato da página em seletor, painéis laterais planos, cabeçalhos sem caixa alta e cores de seleção discretas. Fundo de trabalho neutro e guias desligadas inicialmente. Ajuste automático da largura após carregar o editor e alternar tela cheia; exportação e modelo de dados permanecem inalterados. Backup da interface anterior em /opt/backups/orbita/canvas-visual-20261025.

## Editor em rota própria

O botão Canvas abre `/relatorios/<id>/canvas?unit=<unidade>`. A rota é recarregável e respeita sessão/unidade e acesso administrativo. O editor ocupa o viewport sem modal, navegação geral ou títulos grandes; Voltar retorna ao catálogo. Configurações de fontes e prévias continuam em modais pontuais. Os painéis de páginas/fontes e propriedades podem ser recolhidos e reabertos, com largura ajustável e preferências no navegador. Alterações no relatório continuam exigindo Salvar.

Ao serializar, preservar `dataset`, `column_widths` e a fonte dos blocos de texto que usam metadados; testes cobrem a ida e volta do contrato. Ao sair pelo botão Voltar com alterações, há confirmação; fechar/recarregar com alterações usa proteção do navegador.

### Revisão da rota com Gemini via Agy

Gemini 4 Argon High revisou `CanvasShell.tsx` e `report-canvas.css`; o catálogo do Agy não tinha um identificador separado com o nome Cloud. Shell desacoplado dos estilos globais de modal, controles funcionais compactos, duas faixas alinhadas em desktops menores e uma faixa em telas largas, estados de painel expandidos, popover de larguras ancorado com fechamento ao clicar fora/Escape. Revisão posterior corrigiu a regra de largura dos botões com ícone e texto.

A área de documento permanece na coluna central mesmo quando um painel está oculto. A largura do palco é observada para reenquadrar o zoom após redimensionar a janela. Larguras inválidas de colunas bloqueiam Salvar; redirecionamentos de navegação/unidade limpam o estado da rota Canvas. Nome do relatório na aba do navegador, sem cabeçalho grande no documento. A alteração é de interface e navegação; não ativa envios nem geradores.

Validação da rota publicada: 67 testes de frontend aprovados e build TypeScript/Vite aprovado. QA autenticado confirmou acesso direto, retorno ao catálogo, persistência de largura, recolhimento/expansão dos dois painéis, Escape no popover, enquadramento ao redimensionar em 1024 e 1366 pixels, temas claro e escuro. Backup das fontes anteriores em /opt/backups/orbita/canvas-route-20261025.


### Teste com parâmetros — 25/10/2026
No editor, **Testar** abre um formulário a partir de `parameter_schema` do relatório. Tipos abreviados e definições completas são aceitos; `label`, `order`, `required`, `default`, `minimum`, `maximum`, `not_before` e listas `enum`/`choices` são respeitados. Datas são digitadas em DD/MM/AAAA e convertidas para ISO apenas no envio à API. Campos opcionais vazios não substituem os valores padrão do servidor.

**Gerar prévia** usa o layout em edição sem salvá-lo. PDF é exibido na própria janela e pode ser baixado; XLSX é disponibilizado para download. Alterações dos parâmetros exigem **Atualizar prévia**. A operação não cria envios, não ativa o Canvas e não altera programações.


### Dados de exemplo durante a edição — 25/10/2026
A opção **Dados de exemplo** inicia marcada no editor. Gráficos, tabelas e KPIs de fontes de relatórios usam amostras fictícias locais, respeitando os nomes de colunas, eixos e séries selecionados. Alterar o bloco atualiza sua apresentação imediatamente. Metas sem cadastro também recebem amostra; fontes manuais e metas cadastradas mantêm seus valores. Desmarcar retorna à indicação da fonte.

As amostras não são inseridas no layout nem enviadas à API, não consultam bancos e não participam do PDF/XLSX. **Testar** continua gerando a prévia com os dados das fontes configuradas.


### Métricas do editor — 25/10/2026
Blocos de texto e imagem usam a área integral das coordenadas do papel, sem padding ou bordas ocupando espaço interno. Texto usa Arial/Helvetica, tamanho definido no bloco e entrelinha 1,25; título e conteúdo seguem o mesmo fluxo de linhas da exportação PDF. Imagens preservam a proporção e ficam centralizadas no retângulo inteiro, sem um título adicional consumindo a altura. A correção afeta somente o editor.


### Cadastro visual dos parâmetros — 25/10/2026
Adicionar/Editar relatório contém uma lista de parâmetros com **Adicionar parâmetro**, Editar e Remover. O modal permite nome de bind (sem dois-pontos), rótulo, tipo, obrigatoriedade, ordem, valor padrão, mensagem de solicitação, limites numéricos e referência de data. **Aplicar parâmetro** atualiza o rascunho do formulário; somente **Salvar** no relatório persiste a definição. Cancelar o cadastro do relatório descarta o rascunho.

**Identificar na query** encontra binds `:nome` fora de strings, identificadores entre aspas e comentários. Ignora casts PostgreSQL `::tipo` e literais alternativos Oracle. Acrescenta sugestões sem substituir definições existentes e sem executar SQL. Revisar tipo e obrigatoriedade sugeridos antes de salvar. Definições históricas abreviadas são normalizadas ao editar, preservando metadados adicionais. Renomear parâmetro atualiza referências de validação entre datas, mas não altera a query automaticamente.


### Destaque dos parâmetros na query — 26/10/2026
O campo Consulta SQL destaca binds `:nome` em roxo nos temas claro e escuro. O scanner é o mesmo de Identificar na query; ignora literais, comentários e casts `::tipo`. A área continua sendo um textarea nativo para digitação, seleção e acessibilidade; uma camada visual sincronizada acompanha a rolagem. O destaque não modifica o SQL, não executa consultas e não salva automaticamente.


### Organização Studio do editor — 26/10/2026
A biblioteca do editor usa uma barra vertical com Componentes, Páginas, Dados e Imagens. Clicar novamente no painel ativo recolhe a biblioteca; o botão do cabeçalho também permite recolher. Componentes são inseridos por tiles com ícones maiores e podem ser buscados pelo nome ou por KPI/Gráfico. A seleção de página também está disponível na barra superior.

O inspetor separa **Conteúdo** (título, texto, fonte e campos) de **Aparência** (posição, tamanho, fonte e cores). Duplicar, excluir e mudar camadas ficam fora das abas. As setas navegam entre as abas; atalhos de mover/excluir blocos ignoram botões e seletores. A largura dos painéis continua configurável e o inspetor pode ser recolhido.

O redesign não altera contratos da API, cálculos, fontes reais, ativação, envio ou renderização PDF/XLSX. Mudanças feitas no editor continuam exigindo Salvar.

Validação da entrega Studio: build TypeScript/Vite e 77 testes passaram. Conferidos busca por KPI, inserção/remoção de bloco em rascunho, alternância de painéis, ações persistentes nas abas e navegação por teclado. Temas claro/escuro inspecionados; larguras 1024, 1366 e 1920 sem overflow horizontal global. Os rascunhos de teste foram descartados sem salvar relatórios. Colaboração: Gemini 4 Argon High criou a folha canvas-studio.css; Opus 5.5 High revisou a estrutura, com correções aplicadas antes da publicação.
