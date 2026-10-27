# Portabilidade de relatórios — lote 2

Mapeamento em 25/10/2026, somente leitura nas origens. Acrescentados 31 relatórios finais (29 SIGS e duas composições Firebird) e seis componentes/fontes. Todos continuam desativados/não revisados; alterações no SCV apenas documentam candidatos e pendências. Não foram alterados SQL ativo, conexão ativa de relatório, permissões, programações ou controles de envio.

## Candidatos de menor complexidade: SIGS

Oracle `172.16.2.254:1521/prdpmv`, conexão 6. Consultas usam VDIC_MEGA_RELATORIOS_001; medicamentos, _003; gestantes, _004. Essas views já tiveram dependências diretas verificadas: tabelas Oracle, sem DBLINK. A família SIGS já era Oracle no legado: não apresentá-la como migração de Firebird.

Os 29 SQLs recuperados foram adaptados como candidatos com binds tipados e submetidos ao Oracle com WHERE 1=0 para verificar acesso/colunas. Não executar o sincronizador. Apenas três tiveram amostra de contagem nesta etapa: Pro Povo consultas em 01/10/2026 (4 linhas agrupadas), medicamentos Carobeiras outubro/2026 (194 linhas), gestantes Carobeiras (19 linhas). Conferência de colunas não significa equivalência dos valores ou do PDF; integração futura exclusivamente Canvas.

| Código | Relatório | Família | Restrição fixa preservada |
|---|---|---|---|
| legacy123-266 | RELATORIO DE CONSULTAS - CM PRO POVO | consultas | 91-1 |
| legacy123-276 | RELATORIO DE CONSULTAS - CM JARDIM MARIN | consultas | 92-1 |
| legacy123-277 | RELATORIO DE CONSULTAS - CM SAO JOAO | consultas | 99-1 |
| legacy123-278 | RELATORIO DE CONSULTAS - CM PALMEIRAS | consultas | 83-1 |
| legacy123-279 | RELATORIO DE CONSULTAS - CM COLINAS | consultas | 112-1 |
| legacy123-280 | RELATORIO DE CONSULTAS - CM VILA AMERICA | consultas | 85-1 |
| legacy123-281 | RELATORIO DE CONSULTAS - CM CECAP | consultas | 114-1 |
| legacy123-282 | RELATORIO DE CONSULTAS - CM CAROBEIRAS | consultas | 503-1 |
| legacy123-283 | RELATORIO DE CONSULTAS - CM SAO COSME | consultas | 86-1 |
| legacy123-284 | RELATORIO DE CONSULTAS - CM SIMONSEN | consultas | 84-1 |
| legacy123-285 | RELATORIO DE CONSULTAS - CM PARQUE DAS NACOES | consultas | 94-1 |
| legacy123-286 | RELATORIO DE CONSULTAS - CM VILA PAES | consultas | 98-1 |
| legacy123-287 | RELATORIO DE CONSULTAS - CM NINA | consultas | 423-1 |
| legacy123-321 | RELATORIO DE CONSULTAS - DENGARIO | consultas | 2483-1 |
| legacy123-290 | RELATORIO SAIDA DE MEDICAMENTOS - CAROBEIRAS | medicamentos | FARMACIA CAROBEIRAS - FARMACIA |
| legacy123-294 | RELATORIO SAIDA DE MEDICAMENTOS -  PRO POVO | medicamentos | FARMACIA PRO POVO - FARMACIA |
| legacy123-296 | RELATORIO SAIDA DE MEDICAMENTOS - JARDIM MARIN | medicamentos | FARMACIA JARDIM MARIN - FARMACIA |
| legacy123-297 | RELATORIO SAIDA DE MEDICAMENTOS -  SAO JOAO | medicamentos | FARMACIA SAO JOAO - FARMACIA |
| legacy123-298 | RELATORIO SAIDA DE MEDICAMENTOS -  PALMEIRAS | medicamentos | FARMACIA PALMEIRAS - FARMACIA |
| legacy123-299 | RELATORIO SAIDA DE MEDICAMENTOS -  COLINAS | medicamentos | FARMACIA COLINAS - FARMACIA |
| legacy123-300 | RELATORIO SAIDA DE MEDICAMENTOS -  VILA AMERICA | medicamentos | FARMACIA VILA AMERICA - FARMACIA |
| legacy123-301 | RELATORIO SAIDA DE MEDICAMENTOS -  CECAP | medicamentos | FARMACIA CECAP II - FARMACIA |
| legacy123-302 | RELATORIO SAIDA DE MEDICAMENTOS -  SAO COSME | medicamentos | FARMACIA SAO COSME - FARMACIA |
| legacy123-303 | RELATORIO SAIDA DE MEDICAMENTOS -  SIMONSEN | medicamentos | FARMACIA SIMONSEN - FARMACIA |
| legacy123-304 | RELATORIO SAIDA DE MEDICAMENTOS -  PARQUE DAS NACOES | medicamentos | FARMACIA PARQUE DAS NACOES - FARMACIA |
| legacy123-305 | RELATORIO SAIDA DE MEDICAMENTOS -  VILA PAES | medicamentos | FARMACIA VILA PAES - FARMACIA |
| legacy123-306 | RELATORIO SAIDA DE MEDICAMENTOS - NINA | medicamentos | FARMACIA ESF V - FARMACIA |
| legacy123-292 | RELATORIO GESTANTES - CM  CAROBEIRAS | gestantes | 503-1 |
| legacy123-293 | RELATORIO GESTANTES - CM  PRO POVO | gestantes | 91-1 |

### Regras que precisam permanecer

Consultas dessas variantes agrupa unidade solicitante/CBO, sem a coluna equipe da consulta geral 265; a restrição fixa é UNSA_COD (unidade executante), não o texto UNIDADE_SOLICITANTE. Conta agendamentos distintos por grupo; não exige atendimento concluído, herdando a view. Datas inicial/final tipadas, dia final inteiro. Não aceitar um parâmetro que substitua o filtro fixo da unidade.

Medicamentos usa ano e mês, nomes exatos de estoque. CECAP aponta para FARMACIA CECAP II - FARMACIA e Nina para FARMACIA ESF V - FARMACIA. Não substituir os filtros com base em semelhança do nome. Gestantes usa CODIGO_UNIDADE_REFERENCIA: Carobeiras 503-1 e Pro Povo 91-1, sem perguntas de data; situação atual, sem reconstrução histórica automática.

## Composições Firebird com dados hospitalares recuperáveis

- **55 — Completo Taxa Ocupação:** seis componentes, em ordem 19/24/25/18/58/62. Não é o 20 de dez componentes: não inclui capa/rodapé 43/44 nem divisão cirúrgica 64/65. A parte de ocupação depende de paciente-dia, capacidade histórica e rateio SUS/convênio; o fato de termos snapshot total de leitos em produção não reconcilia esse rateio. Componentes 58/62 usam fontes Oracle abaixo.
- **56 — Indicadores Médicos:** sete componentes, em ordem 38/39/41/54/42/51/52. Não é o 40 já integrado: possui altas até 10h e exames por prestador. Preservar metas, seleção/ordem das especialidades e prestadores, fórmulas e janelas. Não duplicar o layout do 40 apenas por compartilhar o nome.

## Seis componentes/fontes rastreados

| Código | Rotina/caminho | Estado |
|---|---|---|
| 57 | Oracle AVISO_CIRURGIA/CIRURGIA_AVISO e relacionados → Firebird CIRURGIAS | SQL original recuperado e seis colunas conferidas no prdvotu |
| 60 | Oracle ATENDIME e cadastros → ATENDIMENTOS_PS | SQL original recuperado e sete colunas conferidas no prdvotu |
| 58 | PROC_ALTAS_ATE_AS_10 tipo 6, ID 58, SERIES1 → CIRURGIAS | Média total de cirurgias; fórmula/denominador ainda não reconciliados |
| 62 | PROC_ALTAS_ATE_AS_10 tipo 7, ID 62, SERIES1 → ATENDIMENTOS_PS | Média de atendimentos por entrada; fórmula/denominador pendentes |
| 64 | PROC_ALTAS_ATE_AS_10 tipo 20, ID 64, SERIES1 → CIRURGIAS | Cirurgias eletivas; reconciliar classificação e janela |
| 65 | PROC_ALTAS_ATE_AS_10 tipo 21, ID 65, SERIES1 → CIRURGIAS | Urgência/emergência; reconciliar classificação e janela |

Query 57 filtra avisos realizados e empresa 1; SELECT DISTINCT inclui convênio e tipo, logo não se deve equiparar o número de linhas ao número global de avisos distintos. A fonte 60 agrupa competência, data, tipo de atendimento, origem, cidade e convênio. Ambas começam em 2023 e terminam em ontem no SQL legado: futuras consultas precisam de período delimitado. Conferência desta etapa foi de metadados, sem executar toda essa janela.

Componentes não são relatórios WhatsApp independentes; não criar permissões de envio por existir uma fonte. O estado cadastrado legadamente não comprova uso recente. Nenhuma procedure Firebird foi executada ou alterada.

## Acompanhamento e evidências

Planilha principal: https://docs.google.com/spreadsheets/d/13aQJVPIKGuBpi94uvPoQiA0SQo_14NrMDZijqec_YLM/edit, aba Acompanhamento. Atualizadas 37 linhas correspondentes a este lote, com estado amarelo e checkbox desmarcado. A planilha deve acompanhar cada avanço futuro.

Metadados, hashes, SQLs originais e candidatos, parâmetros, filtros, amostras agregadas, composição e backup do SCV: `/opt/backups/orbita/report-mapping-batch2-20261025/`. Fonte original do catálogo: extração em 24/10; acesso de conferência Oracle em 25/10. Senhas e linhas identificáveis de pacientes não fazem parte da evidência.


## Atualização da implementação — 25/10/2026

As 29 variantes SIGS foram integradas ao Canvas e conferidas com dados reais. Consultar MIGRACAO_VARIANTES_SIGS.md para resultados, parâmetros e aceite. Os relatórios 55/56 e seus seis componentes/fontes continuam somente mapeados.
