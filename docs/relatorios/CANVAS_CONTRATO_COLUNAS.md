# Contrato de colunas do Canvas

Atualizado em 26/10/2026. Regra para integrações atuais e futuras.

## Fontes nativas

Cada dataset de `operations.report_canvas.native.datasets()` deve declarar a lista completa de colunas, ou uma função pura `data_de_referencia -> lista de colunas` para janelas variáveis. A função deve ser compartilhada com o montador dos dados exportados. O catálogo usa `dataset_schema.resolve_columns` de forma genérica, sem adicionar uma exceção por relatório em `catalog_datasets`.

Não usar None, lista vazia ou lista parcial para representar uma tabela com colunas desconhecidas. O contrato rejeita colunas ausentes, duplicadas ou inválidas. O limite existente é de 100 colunas. Os metadados do editor não devem abrir conexões hospitalares, executar SQL nem conter dados individuais. A data para os exemplos é a data corrente no fuso da unidade; na geração, o mesmo construtor recebe a referência efetiva do relatório.

## Tabelas novas e fontes SQL

Novos blocos de tabela deixam `options.columns` ausente, significando todas as colunas atuais da fonte. Não selecionar automaticamente as primeiras oito nem gravar uma fotografia parcial da lista. Assim, colunas acrescentadas à fonte passam a aparecer sem recadastrar o bloco. Um subconjunto explicitamente escolhido pelo administrador permanece respeitado, inclusive a ordem.

Editor, inspetor e dados de exemplo usam `sourceColumns()` para resolver a mesma fonte/dataset. Colunas de outro dataset não servem como fallback para um dataset vazio ou desconhecido. Uma fonte SQL sem metadados e sem colunas configuradas exibe a pendência; não inventa uma coluna Período nem consulta a base automaticamente. As colunas podem ser configuradas explicitamente no inspetor. Uma integração nativa deve fornecer seu contrato antes de ser disponibilizada.

Tabelas respeitam `column_widths` e o tamanho de fonte, com quebra de texto e rolagem quando necessária. Não cortar cabeçalhos ou adicionar colunas de configurações antigas de gráficos/KPIs à tabela de exemplo.

## Verificação

`tests/test_canvas_preview_columns.py` cobre o catálogo, contratos genéricos de novos adaptadores, virada do ano e comparação com cabeçalhos da exportação. `canvasSampleData.test.ts` e `canvasTablePreview.test.tsx` cobrem uma fonte futura com 100 colunas, crescimento de 12 para 100, subset explícito e renderização de todos os cabeçalhos.

Nesta alteração: 100 testes backend e 16 frontend aprovados, build TypeScript/Vite concluído. Evidências e backup em `/opt/backups/orbita/canvas-future-columns-20261026T134331Z/`. Não houve mudança em SQL, permissões, agendamentos ou transporte de mensagens.
