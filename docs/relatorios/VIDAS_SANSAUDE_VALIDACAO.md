# Vidas Sansaude - validacao tecnica concluida

Data: 24/10/2026. Relatorio final legacy123-310; componentes 271 (vidas) e 308 (metas). Escopo: fontes, consulta, periodos, metas e reconciliacao dos agregados. Esta conclusao nao significa integracao concluida nem equivalencia integral com producao.

## Parecer

A consulta de vidas pode ser executada diretamente no Oracle, sem Firebird no caminho da consulta. A adaptacao para uma data-alvo preserva os filtros, as quatro alternativas de elegibilidade, DISTINCT, exclusoes e agrupamento do SQL legado 268. A equivalencia exata com os cinco dias da consulta original foi confirmada na mesma transacao de homologacao.

O Firebird tambem mantem fotografias historicas e metas. Recalcular datas antigas no cadastro atual nao garante reproduzir uma fotografia gravada no passado. As metas foram recuperadas e conferidas; sua manutencao futura precisa de fonte explicita. Portanto, a eliminacao completa do Firebird ainda requer preservar/substituir esses dois papeis.

## O que foi executado no Oracle

- Conexao 19 da unidade SCV: 172.16.3.254:1521/hmlvotu.
- Transacao somente leitura; 22 datas distintas consultadas, compartilhando a mesma visao transacional.
- Treze competencias de outubro/2025 a outubro/2026; meses fechados consultados no ultimo dia, competencia corrente em 23/10/2026.
- Dez datas diarias de 14 a 23/10/2026. Datas sobrepostas foram reutilizadas.
- Consulta original de cinco dias, referencia 23/10/2026, comparada por data, contrato, situacao e total com a adaptacao.
- Resultado: igualdade integral nessa comparacao; datas retornadas corretas; totais inteiros e nao negativos; contratos E/I/A; nenhuma chave duplicada por data/contrato/situacao.
- Ensaio anterior com referencia 01/01/2026 confirmou retorno de 27 a 31/12/2025.

Fontes: DBAPS.USUARIO, CONTRATO, GRAU_PARENTESCO, PLANO, TIP_ACOMODACAO e DESLIGAMENTO. Nao substituir a regra historica por um filtro global SN_ATIVO=S: o legado soma os grupos de situacao elegiveis.

## Selecao dos periodos

O composto 310 une primeiro vidas (271) e depois metas (308). O ramo tipo 8 de PROC_ALTAS_ATE_AS_10 consulta SAN_VIDAS_MES por ano/competencia e contrato. Os valores anuais sao fotografias: dezembro do ano anterior e competencia corrente referenciada por ontem. Nao sao a soma dos meses. A serie mensal tem 13 competencias e a diaria dez datas; a meta corresponde a ANO/MES.

As duas barras anuais do PDF de 21/10/2026 repetem dezembro/2025 (17.344) e outubro/2026 (18.565). As doze competencias fechadas conferem integralmente com as fotografias mensais recuperadas. A competencia corrente mudou entre as coletas e deve ser comparada com a mesma data de corte.

O trigger mensal legado combina o dia de ontem com o mes/ano atuais. Isso exige tratamento explicito na virada do mes: o novo sistema deve usar a competencia da data de referencia. Nao foi executado o trigger nem alterada essa rotina.

## Conferencia do legado

A comparacao usa o PDF emitido em 21/10/2026 e os agregados extraidos em 23/10/2026. As cifras do grafico foram transcritas; o ponto divergente foi reconferido visualmente no PDF original.

| Verificacao | Resultado |
|---|---|
| Soma Empresarial + Individual + Adesao | 25/25 pontos do PDF conferem |
| Competencias fechadas out/2025 a set/2026 | 12/12 totais conferem com o cache |
| Metas out/2025 a out/2026 | 13/13 conferem com SAN_VIDAS_METAS |
| Cadastro de metas recuperado | 24 competencias unicas, valores positivos |
| Totais diarios de 11 a 20/10 | 9/10 conferem com o cache posterior |
| Outubro corrente | PDF 18.565; cache mensal posterior 18.539 |

Em 20/10, o PDF mostra 18.565 e o cache diario posterior 18.567. A diferenca esta isolada em Individual: 2.279 no PDF e 2.281 no cache. Empresarial 15.355 e Adesao 931 conferem. O cache Individual inclui 2.280 no grupo S e 1 no N; retirar simplesmente o grupo N nao resolve a diferenca. Sem auditoria individual da fotografia original, a causa dos dois registros nao e demonstravel. Nao corrigimos nem inventamos dados para forcar igualdade.

Homologacao e outra base: em 22/10, HML soma 18.682 e o cache de producao recuperado soma 18.539. Essa diferenca nao mede um erro da adaptacao SQL. Tambem impede afirmar equivalencia produtiva usando somente a homologacao.

## Metas

SAN_VIDAS_METAS armazena ANO, MES e META; as 24 linhas foram recuperadas. A dependencia de leitura pelo ramo de metas foi identificada. Autor, tela ou rotina que alimenta o cadastro nao foram identificados. As tabelas de metas comerciais examinadas no Oracle nao foram comprovadas como origem deste indicador. Nao atribuir essa manutencao ao Oracle ou a uma pessoa sem evidencia.

A integracao pode substituir esse cadastro por metas versionadas no SCV, inicialmente com os valores recuperados e sua procedencia, exigindo uma definicao operacional para novas competencias. Isso e proposta de implementacao, nao funcionalidade entregue nesta validacao.

## Evidencias reproduziveis

Pasta: /opt/backups/orbita/reports-catalog-20261022/vidas-sansaude-20261023/validacao-final-20261024/

- vidas_data_alvo.sql: consulta parametrizada :data_alvo, bind de data sem concatenacao.
- validate_oracle.py: executor de validacao usando conexao criptografada existente, sem credenciais no arquivo.
- resultado_oracle.json: resultados agregados das 22 datas e verificacoes Oracle.
- comparacao_legado.json: comparacoes por competencia/data e verificacoes do PDF/metas.
- oracle.log e oracle.err: registro da execucao.
- manifest.sha256: hashes dos artefatos desta validacao.

Evidencias anteriores: data.json, original_pdf_snapshot.json e validacao-parametrizada-20261024.json na pasta superior; SQL original parametrizado em documentacao-oracle-relatorios-20261023/sql/268_vidas_data_referencia.sql.

## Estado para a migracao

Validacao tecnica encerrada com ressalvas documentadas. Consulta Oracle aprovada em homologacao. Equivalencia integral com fotografias de producao nao aprovada. Relatorio permanece em progresso na tabela de migracao, sem habilitacao por esta etapa.

Para integrar: preservar historico aprovado ou identificar explicitamente valores reconstruidos; cadastrar metas com procedencia e versao; implementar/renderizar as duas paginas; validar acesso, ausencia de dados e geracao. Programacoes e envios nao foram alterados. Nenhum arquivo foi salvo nos servidores legados; nenhuma procedure de negocio, envio ou escrita no Oracle foi executada.

## Metas configuradas no SCV - 24/10/2026

Por decisao do administrador, as 24 metas de 2025/2026 foram relidas de SAN_VIDAS_METAS e cadastradas no relatorio final legacy123-310, unidade SCV. Outubro/2026: 19.420. A tabela original nao foi alterada. A manutencao futura passa a ser realizada no modal Editar do relatorio, secao Metas mensais. Permite adicionar/remover competencias e alterar valores inteiros nao negativos; competencias duplicadas sao rejeitadas.

Campo de dominio: ReportDefinition.monthly_goals. As alteracoes usam permissoes administrativas da unidade, versao concorrente e auditoria existentes. Cada nova ReportExecution preserva monthly_goals em snapshot, independentemente de edicoes posteriores. Metas nao sao parametros solicitados ao destinatario do WhatsApp.

A integracao e a renderizacao do PDF Vidas permanecem pendentes; o futuro gerador deve consumir as metas do snapshot da execucao, sem voltar ao Firebird para buscar metas. A importacao das metas nao habilita o relatorio nem altera programacoes. O responsavel humano pelo cadastro legado permanece desconhecido; isso nao bloqueia a nova manutencao autorizada no SCV.

Validacao: 65 testes de metas, catalogo e indicadores medicos aprovados; build TypeScript/Vite aprovado. Evidencias em /opt/backups/orbita/vidas-editable-goals-20261024/.


## Coletas e históricos — 25/10/2026

Cadastrada a coleta lives-daily, fonte snapshot-lives-oracle (Oracle HML, bind data_alvo). Referência ontem; automática inicialmente desativada. Históricos SAN_VIDAS (124 linhas/22 dias) e SAN_VIDAS_MES (96 linhas/22 competências) importados no PostgreSQL, separados da primeira coleta HML de 24/10 (4 linhas). Metas continuam no cadastro próprio. Isto não implementa nem habilita o PDF composto 310. Ver VALIDACAO_CADASTRO_SNAPSHOTS.md.


## Integração Canvas — 26/10/2026

O composto legacy123-310 foi integrado em duas páginas, usando Oracle produção, fotografias de produção importadas no PostgreSQL e metas SCV. Os estados pendentes acima registram etapas anteriores. Consulta-se VIDAS_SANSAUDE_CANVAS.md para o estado atual e ressalvas. O PDF externo legacy123-269 permanece não recuperado. Envios e automação não foram habilitados.
