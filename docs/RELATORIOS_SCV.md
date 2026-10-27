# Catálogo de relatórios SCV Messenger

## Fluxo e interface

Em Relatórios, as subabas são Relatórios, Conexões, Destinatários, Permissões, Programações e Execuções. Os cadastros são listas; Adicionar/Editar abrem modais. O seletor de unidade continua somente na barra lateral. Operadores veem definições autorizadas e suas próprias execuções; administração do catálogo exige administrador e permissão de escrita na seção. A ajuda contextual abre o guia da tela.

## Conexões e consultas

Conexões por unidade: Oracle, PostgreSQL, MySQL, Firebird e SQLite. Senhas são derivadas/protegidas com a senha do administrador e uma chave de serviço protegida pelo cofre j? existente. A senha do administrador ? conferida ao gravar; senhas e ciphertext não são devolvidos pela API. Alterar credenciais ou destino invalida a validação. Testar executa apenas SELECT 1 e atualiza versão/estado; ativar exige validação. Use contas com privilégios somente de leitura.

SQL usa SELECT ou composição de SELECTs, parâmetros tipados :nome e uma única instrução. Operações de escrita, locks, SELECT INTO e funções administrativas conhecidas são recusadas. Cada driver inicia leitura apenas: SET TRANSACTION READ ONLY no Oracle, default_transaction_read_only no PostgreSQL, START TRANSACTION READ ONLY no MySQL, TPB READ no Firebird, mode=ro e query_only no SQLite. A sessão ? desfeita com rollback. H? limites de tempo, linhas (at? 10 mil), colunas, célula e tamanho de resultado. As consultas não oferecem execução de procedures livres.

SQLite s? l? arquivos existentes em data/report_sources, montados read-only como /app/report_sources na API e workers. Não aceita caminhos para bancos da aplicação ou arquivos fora dessa pasta. Em produção, os resultados CSV/PDF/texto são guardados no PostgreSQL do SCV, separados das fontes externas.

Parâmetros: objeto JSON, cada chave com type (date, integer, number, string), required opcional e default opcional. Exemplo: `{"inicio":{"type":"date","required":true}}`. SQL: `SELECT coluna FROM schema.view WHERE data >= :inicio`. Valores são vinculados no driver, sem interpolação. Composições referenciam códigos de relatórios e parâmetros por parte, em ordem, com detecção de ciclos.

## Permissões e programações

Destinatários representam telefone ou identificador de grupo; vínculo com usuário ? opcional. A permissão ? por relatório/destinatário, com ativo, manual e automático independentes. Pedido manual por usuário não administrador precisa de um vínculo ativo/verificado com o usuário. Destinatários legados com o mesmo telefone continuam registros distintos, sinalizados para revisão. Nenhum usuário da aplicação ? criado a partir da lista de WhatsApp.

Cada programação vincula relatório, destinatário, parâmetros, dias e horário no fuso da unidade. Ativação exige definição pronta, destinatário verificado/ativo e permissão automática. Tick usa bloqueio de linha e restrição única (programação, data), evitando duplicação com workers concorrentes. A permissão ? revalidada na solicitação, geração e download, com fotografia das versões. Mudanças no relatório, conexão, destinatário ou permissão bloqueiam execuções incompatíveis. Toda mutação usa Idempotency-Key e version; conflito retorna 409.

## Manual pelo WhatsApp e transporte

O comando explícito `RELATORIO palavra-chave` aceita um objeto JSON opcional após a palavra-chave. Exemplo: `RELATORIO ocupacao {"inicio":"2026-10-01"}`. S? usa permissões válidas de destinatário verificado e vinculado a usuário ativo. Resultado ambíguo ou sem acesso não revela o catálogo. O fluxo de relatórios operacionais anterior permanece disponível como fallback.

A geração foi separada de envio. Meta/documentos e transporte para grupos legados permanecem com estado pendente explícito. Esta entrega não dispara mensagens reais, não conecta WhatsApp Web e não habilita transporte por inferência. Grupos @g.us não são convertidos em números individuais. A adaptação das integrações de mensagens/rob?/Meta foi expressamente deixada para uma próxima etapa.

## Importação da instalação .123

`python manage.py import_legacy_reports --directory /import --unit scv`

O comando importa uma fotografia de investigação, não acessa Firebird ou Oracle. ? aditivo/idempotente, bloqueia a unidade durante a importação e não sobrescreve alterações posteriores. Todas as definições, destinatários, permissões e programações novas entram desativadas. As origens de conexão são placeholders Oracle sem segredos importados. O cache Firebird legado não ? necessário para o novo funcionamento; procedures e consultas dependentes dele aguardam equivalência direta no Oracle.

Preserva definição original, SQL, parâmetros, palavras-chave, ordem das partes, contatos/grupos, permissões e calendários. PDFs de Excel/PowerPoint/Tableau ficam pendentes at? disponibilizar fonte/mecanismo; procedures compiladas sem fonte não são convertidas automaticamente. Rotinas de sincronização/limpeza e itens do rob?/Meta não são executáveis como SQL de leitura. Vínculos órfãos ficam no relatório de inconsistências do evento de importação; a tela mostra as pendências.

Nesta importação: 321 definições, 101 destinatários e 461 permissões resolvidas; outras 17 permissões órfãs preservadas no inventário de inconsistências. As 50 programações entram desativadas, preservando o STATUS original no JSON legado. H? quatro programações originalmente desativadas sem permissão. Nenhum segredo das conexões legadas ? importado. Arquivos com contatos são mantidos fora do repositório em backup privado do servidor.

## API

- `/api/v1/reports/`: catálogo existente ampliado, `configure`, `preview`, `inventory`.
- `/api/v1/report-connections/`: conexões, `configure`, `test`.
- `/api/v1/report-recipients/`: destinatários, `configure`, `verify`, `users`.
- `/api/v1/report-grants/`: permissões, `configure`.
- `/api/v1/report-automations/`: programações, `configure`.
- `/api/v1/report-executions/`: solicitar, listar e `download`.

Todas exigem unidade/autenticação; segredos e administração não ficam acessíveis a operadores. Resultados não aparecem no JSON da listagem. Downloads usam no-store e revalidam autorização. Os endpoints antigos report-access/report-schedules/report-requests são mantidos para compatibilidade dos relatórios operacionais j? existentes.

## Verificação

A suíte test_report_catalog cobre SQL de leitura real em SQLite, bind de parâmetros, bloqueio de escrita, diretório permitido, credenciais criptografadas, isolamento entre unidades, permissões de seção, conflitos, idempotência, importação repetida com números compartilhados e vínculos órfãos, revogação durante fila/download e concorrência em PostgreSQL. Não executa procedures legadas nem envia mensagens.

Parâmetros definidos na permissão restringem a execução e prevalecem sobre os parâmetros informados no pedido. PARAMETRO1 legado precisa ser mapeado antes de ativar o vínculo. O usuário não administrador só pode escolher destinatários vinculados a ele; quando existe um único vínculo elegível, o backend o seleciona.

## Filtros e aba Revisar

Relatórios e Revisar têm busca, filtros de origem, situação, conexão e presença de SQL, aplicados no servidor antes da paginação. Rotinas legadas de sincronização e limpeza ficam em Revisar. O ícone de lixeira move para revisão sem excluir; a ação Restaurar devolve à lista principal mantendo o item desativado. Consultas, vínculos, permissões e histórico são preservados. Itens em Revisar não podem ser executados. A animação respeita a preferência de movimento reduzido.

## Parâmetros identificados

O modal do relatório apresenta os parâmetros do cadastro legado, do esquema SCV e as referências encontradas no SQL. Mostra tipo, máscara original, ordem, conteúdo cadastrado e evidência do vínculo. Binds atuais, marcadores legados e vínculos pendentes têm estados distintos. Nomes divergentes não são corrigidos automaticamente; fragmentos SQL não viram valores executáveis. Composições mostram parâmetros de seus componentes, restritos à mesma unidade. Ausência de metadados não comprova ausência de parâmetros em procedures não recuperadas. O levantamento não executa consultas nem altera o esquema de parâmetros.

## Filtros de permissões

A aba Permissões permite combinar busca por relatório/código, nome ou endereço do destinatário com relatório, destinatário, situação ativa/desativada, modalidade manual/automática/ambas/nenhuma e tipo telefone/grupo. As modalidades Manual e Automática incluem vínculos que permitem ambas. Os filtros são aplicados no servidor antes da paginação e restritos à unidade selecionada. Limpar filtros restaura a lista da primeira página.

## Filtros de programações

Programações permite busca por relatório/código, destinatário ou endereço e filtros combinados de relatório, destinatário, situação, dia da semana, intervalo de horário inclusivo e tipo telefone/grupo. O intervalo não atravessa a meia-noite; horário final anterior ao inicial retorna erro. Os resultados e totais são filtrados no servidor antes da paginação, sempre na unidade selecionada. Limpar filtros retorna à primeira página.


## Relatórios finais e componentes

O catálogo usa `catalog_kind`: `report` para documentos finais e `component` para consultas, gráficos, tabelas, cabeçalhos, rodapés e rotinas auxiliares. A antiga aba Revisar foi substituída por Componentes, com ícone de blocos e sem animação. Os códigos, consultas, permissões legadas, históricos e vínculos são preservados.

A migração identifica saídas finais pelas permissões manual/automática e programações cadastradas, além dos relatórios nativos e novos cadastros próprios. Permissões de recebimento têm prioridade sobre o nome e o uso técnico: um cadastro autorizado permanece em Relatórios mesmo quando também compõe outro documento. Auxiliares sem vínculo de entrega ficam em Componentes. Isso indica finalidade cadastrada, não uso recente nem liberação para enviar.

A lista normal e os seletores de geração, permissões e programação exibem relatórios finais. Componentes ficam restritos à administração, com prévia técnica somente leitura. Na lista é possível consultar quais composições usam o componente, incluindo vínculos anteriores preservados dos Indicadores Médicos.

Componentes não podem receber permissões/programações novas, aparecer no menu do WhatsApp ou ser executados como saída independente. A coleta interna pela composição continua funcionando. Mover para Componentes preserva SQL e estado de disponibilidade para as composições, mas pausa programações próprias; mover de volta não as reativa.

API: GET /api/v1/reports/?section=reports (padrão), section=components (administrador) ou section=all. O parâmetro antigo section=review permanece por compatibilidade de clientes. `review_queue` continua preservado para rotinas legadas bloqueadas, mas deixou de definir a navegação.

Os parâmetros do relatório principal aparecem primeiro. Os binds técnicos dos componentes ficam recolhidos no modal, em Parâmetros internos dos componentes. Esta reorganização não habilita envios nem altera o bloqueio dos Indicadores Médicos em homologação.

### Critério de classificação por permissões

Permissão cadastrada para recebimento manual ou automático tem prioridade sobre nome, tipo técnico, participação em composição ou RETORNO_TEXTO do legado. O cadastro permanece em Relatórios mesmo se também servir como parte de outro documento. Permissões legadas desativadas continuam sendo evidência da finalidade cadastrada. Vínculos de acesso da estrutura anterior também são considerados.

A classificação não habilita execução ou entrega. Rotinas com permissões antigas aparecem em Relatórios com seus bloqueios, revisão e estado de ativação preservados. Componentes são os auxiliares sem permissão de recebimento independente.

Validação em 23/10/2026: unidade SCV com 141 relatórios e 194 componentes. Nenhum componente mantém permissão de recebimento manual/automático; dez cadastros foram promovidos pela evidência das permissões. Os dez continuam desativados e sem revisão aprovada. Nenhuma programação de componente está ativa. Regressão: 74 testes aprovados. O PDF médico integrado continua disponível pela API (HTTP 200).
