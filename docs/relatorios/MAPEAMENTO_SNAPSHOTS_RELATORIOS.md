# Mapeamento de snapshots dos relatórios

Data: 25/10/2026. Catálogo atual do SCV Messenger em 172.16.0.59; cruzamento com definições, composição, dependências Firebird e validações legadas preservadas de 22–24/10. Escopo: todos os 354 cadastros atuais, incluindo relatórios, componentes e rotinas; não apenas os ativos.

## Critério

- Snapshot histórico: posição preservada de uma data/competência, cuja reprodução não é garantida pela consulta ao cadastro atual.
- Cache operacional: movimentos/cadastros copiados do hospitalar; ter uma coluna de data não prova snapshot diário.
- Agregado mensal persistido: série mensal materializada; mutabilidade e possibilidade de reconstrução precisam de validação por ramo.
- Metas são cadastro operacional, não fotografia automática de leitos/vidas.
- ReportExecution.snapshot preserva configuração/permissões da geração. Isso existe para rastreabilidade e não significa que todos os relatórios usem snapshots históricos de dados.
- Não confundir transação Firebird SNAPSHOT somente leitura com uma tabela histórica de snapshots.
- Dependências globais de uma procedure abrangem vários ramos. Só vinculamos snapshots como confirmados quando o relatório/ramo ou composição foi identificado; os demais permanecem candidatos.
- Ativo é o estado cadastrado; não comprova execução recente. Ausência de referência não prova inexistência de snapshot dentro de view, procedure ou gerador externo não inspecionado.

## Resultado quantitativo

- Dados operacionais nativos do SCV: 24 cadastros.
- Snapshot não identificado; origem/ramo a validar: 15 cadastros.
- Consulta Oracle; snapshot não identificado: 58 cadastros.
- Agregado mensal persistido; semântica de snapshot a validar: 179 cadastros.
- Rotina de alimentação/manutenção: 17 cadastros.
- Arquivo externo; geração fora do catálogo: 5 cadastros.
- Snapshot histórico confirmado: 9 cadastros.
- Cache operacional; snapshot histórico não comprovado: 47 cadastros.

## Relatórios finais que consomem snapshots históricos no legado

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| scv / legacy123-20 | COMPLETO TAXA OCUPAÇÃO | report | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-271 | VIDAS SANSAUDE | report | Não | SAN_VIDAS, SAN_VIDAS_MES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-310 | INDICADORES - VIDAS SANSAUDE | report | Não | SAN_VIDAS, SAN_VIDAS_MES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-311 | EXPORTAR TABELA LEITOS | report | Sim | LEITOS_SISTEMA | PostgreSQL: snapshots históricos |
| scv / legacy123-55 | COMPLETO TAXA OCUPAÇÃO | report | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |

## Componentes que leem os snapshots

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| scv / legacy123-18 | TAXA DE OCUPAÇÃO POR SETOR | component | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-19 | PACIENTE DIA E TAXA DE OCUPAÇÃO - GERAL | component | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-24 | PACIENTE DIA E TAXA DE OCUPAÇÃO - SUS | component | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-25 | PACIENTE DIA E TAXA DE OCUPAÇÃO - CONVENIO | component | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |

## Cadeias confirmadas

| Fonte persistida | Quem alimenta / origem | Consumidores | Necessidade para migração |
|---|---|---|---|
| LEITOS_SISTEMA | Consulta Oracle de posição atual (sincronizador legado 17); histórico legado importado | 311; indiretamente cálculo de capacidade | Manter coleta por data no PostgreSQL. Histórico não é reconstruído apenas com LEITO atual. |
| LEITOS_DISPONIVEIS | PROC_LEITOS_DISPONIVEIS: LEITOS_SISTEMA e rateio CADASTRO_LEITOS | Componentes 18/19/24/25; compostos 20/55 | Preservar capacidade histórica SUS/convênio e vigência do cadastro manual; fotografia total de leitos não substitui o rateio. |
| SAN_VIDAS / SAN_VIDAS_MES | Consulta Oracle → SAN_VIDAS_TEMP → trigger SAN_VIDAS_TEMP_BIU0 → valores por data/competência | 271 e composto 310 | Preservar fotografias diárias/mensais. Os valores anuais são posições selecionadas; não soma dos meses. |
| SAN_VIDAS_METAS | Cadastro legado recuperado; autoria/alimentação original não comprovada | 308 e composto 310 | Metas já cadastradas/versionadas no SCV. Não é coleta de snapshot Oracle. |

## Situação operacional da coleta no SCV

A única configuração de coleta cadastrada na leitura desta tarefa é a de leitos: origem componente 354 (bed-position-oracle), saída 311, Oracle hmlvotu e PostgreSQL, habilitada diariamente às 04:20:23 na unidade SCV. A origem e o ambiente são homologação. O histórico de produção importado permanece separado. Nenhuma coleta nova de Vidas, rateio de capacidade, ACS ou robô foi criada por este mapeamento.

Os consumidores de leitos dispõem de 698 registros históricos reais em 50 datas (01/09–23/10), com lacunas preservadas. A integração de ocupação ainda exige o histórico de LEITOS_DISPONIVEIS e o cadastro operacional; não basta apontar seu cálculo para os snapshots totais do XLSX.

## Caches e agregados que exigem revisão própria

| Família | Tabelas identificadas | Interpretação / cuidado |
|---|---|---|
| Indicadores médicos (40/56/53 e componentes) | INTERNACAO_USUARIO, ATENDIMENTOS, EXAMES, PARECER, PARECER_ATENDIMENTOS | Cache hospitalar. O handler integrado do relatório 40 consulta Oracle diretamente; não foi encontrada exigência de snapshot diário nesse handler. Cache antigo pode diferir por correções tardias. |
| Atendimentos e cirurgias nos Informativos | ATENDIMENTOS_PS, CIRURGIAS | Dados copiados por cargas; sua presença na mesma composição de ocupação não transforma esses movimentos em fotografia de capacidade. |
| Indicadores de WhatsApp/robô por unidade | TBAVISOS e CADASTRO_PRESTADORES_MENSAL | Fonte de eventos e agregado mensal identificados por metadados da procedure. Validar o ramo TIPO e a gravação da série antes de chamar de snapshot obrigatório. Não substituir por consulta Oracle hospitalar. |
| Produção ACS/eSUS | PRODUCAO_AGENTE_MENSAL | Agregado mensal persistido; há rotina tipo 1 para geração mensal. Confirmar janelas, atualização e consumo por ramo/unidade. |
| FPO financeiro/físico | PROC_FPO e auxiliares; FPO_AIH/FPO_AMBULATORIAL nas cargas | Dependência das procedures auxiliares não está integralmente expandida na evidência; não há conclusão de snapshot histórico confirmado. |
| PDFs externos de Controladoria | Arquivos publicados | O catálogo só recebe o arquivo. Uso de snapshots na criação externa é desconhecido neste mapeamento. |

## Inventário completo por classificação

### Dados operacionais nativos do SCV

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| ame / combined | Agendamentos não enviados / não confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| ame / confirmed | Agendamentos confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| ame / contacts | Acompanhamentos e contatos | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| ame / declined | Agendamentos recusados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| ame / failures | Falhas e bloqueios de comunicação | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| ame / no-response | Sem resposta no prazo | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| ame / not-confirmed | Agendamentos não confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| ame / not-sent | Agendamentos com mensagens não enviadas | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / combined | Agendamentos não enviados / não confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / confirmed | Agendamentos confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / contacts | Acompanhamentos e contatos | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / declined | Agendamentos recusados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / failures | Falhas e bloqueios de comunicação | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / no-response | Sem resposta no prazo | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / not-confirmed | Agendamentos não confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / not-sent | Agendamentos com mensagens não enviadas | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / combined | Agendamentos não enviados / não confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / confirmed | Agendamentos confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / contacts | Acompanhamentos e contatos | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / declined | Agendamentos recusados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / failures | Falhas e bloqueios de comunicação | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / no-response | Sem resposta no prazo | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / not-confirmed | Agendamentos não confirmados | report | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / not-sent | Agendamentos com mensagens não enviadas | report | Sim | — | Não implementado/habilitado como snapshot no SCV |

### Snapshot não identificado; origem/ramo a validar

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| ame / legacy-stock | Estoque — entrada e saída de empréstimos | report | Não | — | Não implementado/habilitado como snapshot no SCV |
| sansaude / legacy-stock | Estoque — entrada e saída de empréstimos | report | Não | — | Não implementado/habilitado como snapshot no SCV |
| scv / legacy-stock | Estoque — entrada e saída de empréstimos | report | Não | — | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-164 | PRODUCAO_AGENTE | component | Não | SINCRONIZAR | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-173 | PRODUCAO_AGENTE | report | Não | PRODUCAO_AGENTE_ESUS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-259 | PRODUCAO_AGENTE | component | Não | SINCRONIZAR | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-308 | VIDAS SANSAUDE - METAS | report | Não | SAN_VIDAS_METAS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-317 | CONSULTAS_MEDICAS | component | Não | SINCRONIZAR_ROB8 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-327 | RANKING GRAFICO BUSCA ATIVA | component | Não | — | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-43 | TAXA DE OCUPAÇÃO - CABECALHO  | component | Não | CADCLI | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-44 | TAXA DE OCUPAÇÃO - RODAPE | component | Não | CADCLI | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-45 | ALTAS ATE AS 10 HORAS - CABECALHO | component | Não | CADCLI | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-46 | ALTAS ATE AS 10 HORAS - RODAPE | component | Não | CADCLI | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-75 | FPO - MAC DECENDIO FINANCEIRO | report | Não | PROC_FPO_CALCULA_PERCENTUAL, PROC_FPO_RETORNA_IMAGEM, PROC_FPO_SET_NULL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-81 | FPO - MAC DECENDIO FISICO | report | Não | PROC_FPO_CALCULA_PERCENTUAL, PROC_FPO_RETORNA_IMAGEM, PROC_FPO_SET_NULL | Não implementado/habilitado como snapshot no SCV |

### Consulta Oracle; snapshot não identificado

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| scv / bed-position-oracle | Leitos · posição atual no Oracle | component | Sim | — | Coletor Oracle → PostgreSQL |
| scv / legacy123-1 | ESTOQUE - ENTRADA E SAIDA DE EMPRESTIMOS | report | Não | ENT_PRO, ITMVTO_ENT, MVTO_ESTOQUE | Oracle direto; sem snapshot persistente no handler |
| scv / legacy123-26 | CONSULTAS_MEDICAS_AME_VOTU | report | Não | TBL_LOG_MEGA_MSG, VDIC_CONSULTA_AGENDA_ENVIO_MSG | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-265 | RELATORIO DE CONSULTAS | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-266 | RELATORIO DE CONSULTAS - CM PRO POVO | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-27 | EXAMES_MEDICOS_AME_VOTU | report | Não | TBL_LOG_MEGA_MSG, VDIC_EXAME_AGENDA_ENVIO_MSG | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-272 | RELATORIO DE CONSULTAS POR PROCEDIMENTO | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-275 | RELATORIO DE CONSULTAS - CM PAINEIRAS | component | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-276 | RELATORIO DE CONSULTAS - CM JARDIM MARIN | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-277 | RELATORIO DE CONSULTAS - CM SAO JOAO | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-278 | RELATORIO DE CONSULTAS - CM PALMEIRAS | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-279 | RELATORIO DE CONSULTAS - CM COLINAS | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-280 | RELATORIO DE CONSULTAS - CM VILA AMERICA | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-281 | RELATORIO DE CONSULTAS - CM CECAP | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-282 | RELATORIO DE CONSULTAS - CM CAROBEIRAS | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-283 | RELATORIO DE CONSULTAS - CM SAO COSME | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-284 | RELATORIO DE CONSULTAS - CM SIMONSEN | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-285 | RELATORIO DE CONSULTAS - CM PARQUE DAS NACOES | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-286 | RELATORIO DE CONSULTAS - CM VILA PAES | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-287 | RELATORIO DE CONSULTAS - CM NINA | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-288 | RELATORIO DE CONSULTAS - POLICLINICA | component | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-289 | RELATORIO SAIDA DE MEDICAMENTOS | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-290 | RELATORIO SAIDA DE MEDICAMENTOS - CAROBEIRAS | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-291 | RELATORIO GESTANTES POR UNIDADE | report | Não | VDIC_MEGA_RELATORIOS_004 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-292 | RELATORIO GESTANTES - CM  CAROBEIRAS | report | Não | VDIC_MEGA_RELATORIOS_004 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-293 | RELATORIO GESTANTES - CM  PRO POVO | report | Não | VDIC_MEGA_RELATORIOS_004 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-294 | RELATORIO SAIDA DE MEDICAMENTOS -  PRO POVO | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-295 | RELATORIO SAIDA DE MEDICAMENTOS -  PAINEIRAS | component | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-296 | RELATORIO SAIDA DE MEDICAMENTOS - JARDIM MARIN | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-297 | RELATORIO SAIDA DE MEDICAMENTOS -  SAO JOAO | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-298 | RELATORIO SAIDA DE MEDICAMENTOS -  PALMEIRAS | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-299 | RELATORIO SAIDA DE MEDICAMENTOS -  COLINAS | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-30 | INTERNACAO_USUARIO | component | Não | ATENDIME | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-300 | RELATORIO SAIDA DE MEDICAMENTOS -  VILA AMERICA | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-301 | RELATORIO SAIDA DE MEDICAMENTOS -  CECAP | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-302 | RELATORIO SAIDA DE MEDICAMENTOS -  SAO COSME | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-303 | RELATORIO SAIDA DE MEDICAMENTOS -  SIMONSEN | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-304 | RELATORIO SAIDA DE MEDICAMENTOS -  PARQUE DAS NACOES | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-305 | RELATORIO SAIDA DE MEDICAMENTOS -  VILA PAES | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-306 | RELATORIO SAIDA DE MEDICAMENTOS - NINA | report | Não | VDIC_MEGA_RELATORIOS_003 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-312 | RELATORIO DE EXAMES REGULADOS UPA-PA | report | Não | VDIC_MEGA_RELATORIOS_011 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-321 | RELATORIO DE CONSULTAS - DENGARIO | report | Não | VDIC_MEGA_RELATORIOS_001 | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-33 | ATENDIMENTOS | component | Não | DBAMV | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-35 | EXAMES | component | Não | DBAMV, SET_EXA | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-57 | CIRURGIAS | component | Não | ATENDIME | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-60 | ATENDIMENTOS_PS | component | Não | DBAMV | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-66 | PARECER | component | Não | PAR_MED | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-67 | PARECER_ATENDIMENTOS | component | Não | DBAMV | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-69 | FPO_AMBULATORIAL | component | Não | ATENDIME, EVE_SIASUS, FAT_SIA, GRUPO_PROCEDIMENTOS, ORGANIZA_GRUPO_PROCEDIMENTOS, ORI_ATE, PROCEDIMENTO_SUS, PROCEDIMENTO_SUS_COMPLEXIDADE, REMESSA_APAC, REMESSA_BPA, SUB_GRUPO_PROCEDIMENTOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-70 | FPO_AIH | component | Não | V_FFIS_VALOR_CONTA_AIH | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-71 | AGENDAMENTOS NAO CONFIRMADOS - RESTRICOES | report | Não | VDIC_CONS_AGENDA_ENVIO_MSG_SAN | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-72 | FPO_PROCEDIMENTO_SUS | component | Não | PROCEDIMENTO_SUS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-74 | FPO_COMPLEXIDADE_AMB | component | Não | PROCEDIMENTO_SUS_COMPLEXIDADE | Não implementado/habilitado como snapshot no SCV |
| scv / medical-attendances | Indicadores Médicos · Atendimentos de urgência por dia | component | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / medical-exams | Indicadores Médicos · Exames realizados por dia | component | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / medical-opinions-days | Indicadores Médicos · Pareceres de urgência por dia | component | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / medical-opinions-months | Indicadores Médicos · Pareceres de urgência por mês | component | Sim | — | Não implementado/habilitado como snapshot no SCV |
| scv / medical-stays | Indicadores Médicos · Permanência por convênio e especialidade | component | Sim | — | Não implementado/habilitado como snapshot no SCV |

### Agregado mensal persistido; semântica de snapshot a validar

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| scv / legacy123-100 | COLINAS - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-101 | COLINAS - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-102 | NAS - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-103 | PARQUE DAS NAÇÕES - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-104 | PARQUE DAS NAÇÕES - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-105 | PARQUE DAS NAÇÕES - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-106 | PARQUE DAS NAÇÕES - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-107 | VILA PAES - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-108 | VILA PAES - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-109 | VILA PAES - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-110 | VILA PAES - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-111 | DONA NINA - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-112 | DONA NINA - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-113 | DONA NINA - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-114 | DONA NINA - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-115 | SÃO COSME - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-116 | SÃO COSME - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-117 | SÃO COSME - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-118 | SÃO COSME - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-119 | AME SANTA FE - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-120 | AME SANTA FE - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-121 | AME SANTA FE - MÉDIA DE LIGAÇÕES POR ATENDENTE | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-122 | AME SANTA FE - QUANTIDADE DE PACIENTES CONTATADOS | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-123 | AME SANTA FE - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-124 | AME JALES - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-125 | AME JALES - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-126 | AME JALES - MÉDIA DE LIGAÇÕES POR ATENDENTE | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-127 | AME JALES - QUANTIDADE DE PACIENTES CONTATADOS | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-128 | AME JALES - QUANTIDADE DE RESPOSTAS POR WHATSAPP | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-129 | GRUPO SANTA CASA - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-130 | JARDIM MARIN - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-131 | JARDIM MARIN - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-132 | JARDIM MARIN - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-133 | JARDIM MARIN - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-134 | CECAP - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-135 | CECAP - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-136 | CECAP - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-137 | CECAP - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-138 | VILA AMÉRICA - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-139 | VILA AMÉRICA - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-140 | VILA AMÉRICA - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-141 | VILA AMÉRICA - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-142 | PAINEIRAS - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-143 | PAINEIRAS - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-144 | PAINEIRAS - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-145 | PAINEIRAS - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-146 | PALMEIRAS - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-147 | PALMEIRAS - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-148 | PALMEIRAS - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-149 | PALMEIRAS - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-150 | SÃO JOÃO - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-151 | SÃO JOÃO - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-152 | SÃO JOÃO - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-153 | SÃO JOÃO - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-154 | SIMONSEN - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-155 | SIMONSEN - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-156 | SIMONSEN - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-157 | SIMONSEN - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-158 | CAROBEIRAS - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-159 | CAROBEIRAS - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-160 | CAROBEIRAS - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-161 | CAROBEIRAS - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-165 | UBS VILA PAES - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-166 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-167 | UBS VILA PAES - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-168 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-169 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-170 | RANKING MÉDIA VISITAS ACS POR UNIDADE DE SAUDE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-171 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-175 | UBS GERAL - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-176 | UBS GERAL - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-177 | UBS PAINEIRAS - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-178 | UBS CECAP - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-179 | UBS PARQUE DAS NACOES - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-180 | UBS VILA AMERICA - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-181 | UBS SAO JOAO - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-182 | UBS VILA MARIN - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-183 | UBS CAROBEIRAS - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-184 | UBS COLINAS - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-185 | UBS PRO-POVO - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-186 | UBS PALMEIRAS - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-187 | UBS SAO COSME - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-188 | UBS SIMONSEN - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-189 | UBS DONA NINA - PRODUÇÃO ACS | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-190 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-191 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-192 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-193 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-194 | UBS CAROBEIRAS - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-195 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-196 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-197 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-198 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-199 | UBS CECAP - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-200 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-201 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-202 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-203 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-204 | UBS COLINAS - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-205 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-206 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-207 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-208 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-209 | UBS DONA NINA - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-210 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-211 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-212 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-213 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-214 | UBS PAINEIRAS - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-215 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-216 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-217 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-218 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-219 | UBS PALMEIRAS - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-220 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-221 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-222 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-223 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-224 | UBS PARQUE DAS NACOES - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-225 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-226 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-227 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-228 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-229 | UBS PRO-POVO - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-230 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-231 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-232 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-233 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-234 | UBS SAO COSME - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-235 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-236 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-237 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-238 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-239 | UBS SAO JOAO - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-240 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-241 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-242 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-243 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-244 | UBS SIMONSEN - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-245 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-246 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-247 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-248 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-249 | UBS VILA AMERICA - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-251 | GRAFICO FICHAS SEM CPF | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-252 | GRAFICO FICHAS SEM NOME PACIENTE | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-253 | GRAFICO POR DESFECHO DE VISITA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-254 | GRAFICO VISITAS POR MICRO AREA | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-255 | UBS VILA MARIN - PRODUÇÃO ACS | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-257 | ESUS - SINCRONIZAR COMPLETO | report | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-260 | POLICLINICA - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-261 | POLICLINICA - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-262 | POLICLINICA - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-263 | POLICLINICA - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-331 | AME JALES - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP PÓS CIRÚGICO | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-332 | AME JALES - MÉDIA DE LIGAÇÕES POR ATENDENTE PÓS CIRÚGICO | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-333 | AME JALES - QUANTIDADE DE PACIENTES CONTATADOS PÓS CIRÚGICO | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-334 | AME JALES - QUANTIDADE DE RESPOSTAS POR WHATSAPP PÓS CIRÚGICO | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-335 | AME JALES - INDICADORES PÓS CIRÚGICO | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-337 | CECAP - QUANTIDADE DE RESPOSTAS POR WHATSAPP | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-401 | INDICADORES - BUSCA ATIVA | report | Não | CADASTRO_PRESTADORES_MENSAL, PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-413 | INDICADORES - BUSCA ATIVA | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-82 | AME VOTUPORANGA - MÉDIA DE LIGAÇÕES POR ATENDENTE | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-83 | AME VOTUPORANGA - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-84 | AME VOTUPORANGA - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-85 | AME VOTUPORANGA - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-86 | AME VOTUPORANGA - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-87 | SANSAUDE - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-88 | SANSAUDE - MÉDIA DE LIGAÇÕES POR ATENDENTE | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-89 | SANSAUDE - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-90 | SANSAUDE - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-91 | SANSAUDE - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-92 | INDICADORES AME E SANSAUDE | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-93 | PRO POVO - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-94 | PRO POVO - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-96 | PRO POVO - QUANTIDADE DE PACIENTES CONTATADOS | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-97 | PRO POVO - QUANTIDADE DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-98 | COLINAS - INDICADORES | report | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-99 | COLINAS - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | component | Não | CADASTRO_PRESTADORES_MENSAL | Não implementado/habilitado como snapshot no SCV |

### Rotina de alimentação/manutenção

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| scv / legacy123-16 | PACIENTES_DIA | component | Não | DBAMV | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-17 | LEITOS_SISTEMA | component | Não | LEITO, UNID_INT | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-174 | ESUS - GERAR TABELA MENSAL | component | Não | PRODUCAO_AGENTE_MENSAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-22 | LIMPAR_PACIENTES_DIA | component | Não | PACIENTES_DIA | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-23 | GERAR_LEITOS_DISPONIVEIS | component | Não | CADASTRO_LEITOS, LEITOS_DISPONIVEIS, LEITOS_SISTEMA | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-256 | LIMPAR_PRODUCAO_AGENTE | component | Não | PRODUCAO_AGENTE | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-258 | ALTERAR MES PRODUCAO ACS | report | Não | TBAGENDADOR_ENV_REL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-268 | SAN_VIDAS_TEMP | component | Não | DESLIGAMENTO, USUARIO | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-28 | 52 - LIMPAR_CONSULTAS_MEDICAS_AME_VOTU | component | Não | CONSULTAS_MEDICAS_AME_VOTU | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-29 | 53 - LIMPAR_EXAMES_MEDICAS_AME_VOTU | component | Não | EXAMES_MEDICOS_AME_VOTU | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-31 | LIMPAR_INTERNACAO_USUARIO | component | Não | INTERNACAO_USUARIO | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-32 | LIMPAR_ATENDIMENTOS | component | Não | ATENDIMENTOS, ATENDIMENTOS_PS, FPO_AIH, FPO_AMBULATORIAL, PARECER, PARECER_ATENDIMENTOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-34 | LIMPAR_EXAMES | component | Não | CIRURGIAS, EXAMES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-59 | 00 - SINCRINIZAR COMPLETO PARTE 1 | component | Não | ATENDIMENTOS, ATENDIMENTOS_PS, CIRURGIAS, EXAMES, FPO_AIH, FPO_AMBULATORIAL, INTERNACAO_USUARIO, PARECER, PARECER_ATENDIMENTOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-61 | 00 - SINCRINIZAR COMPLETO PARTE 2 | component | Não | PACIENTES_DIA | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-78 | LIMPAR TABELAS AMB E AIH | component | Não | FPO_AIH, FPO_AMBULATORIAL | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-79 | ATUALIZAR FPO | report | Não | FPO_AIH, FPO_AMBULATORIAL | Não implementado/habilitado como snapshot no SCV |

### Arquivo externo; geração fora do catálogo

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| scv / legacy123-162 | INDICADORES GERENCIAIS | report | Sim | CADCLI | Arquivo PDF publicado; conteúdo não recalculado pelo SCV |
| scv / legacy123-163 | INDICADORES ESTRATEGICOS | report | Sim | CADCLI | Arquivo PDF publicado; conteúdo não recalculado pelo SCV |
| scv / legacy123-269 | INDICADORES VIDAS SANSAUDE | report | Não | CADCLI | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-270 | INDICADORES INTERNACOES PS | report | Não | CADCLI | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-309 | INDICADORES - PAINEL LEITOS | report | Sim | CADCLI | Arquivo PDF publicado; conteúdo não recalculado pelo SCV |

### Snapshot histórico confirmado

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| scv / legacy123-18 | TAXA DE OCUPAÇÃO POR SETOR | component | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-19 | PACIENTE DIA E TAXA DE OCUPAÇÃO - GERAL | component | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-20 | COMPLETO TAXA OCUPAÇÃO | report | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-24 | PACIENTE DIA E TAXA DE OCUPAÇÃO - SUS | component | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-25 | PACIENTE DIA E TAXA DE OCUPAÇÃO - CONVENIO | component | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-271 | VIDAS SANSAUDE | report | Não | SAN_VIDAS, SAN_VIDAS_MES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-310 | INDICADORES - VIDAS SANSAUDE | report | Não | SAN_VIDAS, SAN_VIDAS_MES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-311 | EXPORTAR TABELA LEITOS | report | Sim | LEITOS_SISTEMA | PostgreSQL: snapshots históricos |
| scv / legacy123-55 | COMPLETO TAXA OCUPAÇÃO | report | Não | LEITOS_DISPONIVEIS | Não implementado/habilitado como snapshot no SCV |

### Cache operacional; snapshot histórico não comprovado

| Unidade / código | Nome | Tipo | Ativo | Dependência | Situação no SCV |
|---|---|---|---|---|---|
| scv / legacy123-315 | INDICADORES - RANKING FALTANTES | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-319 | GESTÃO DE MENSAGENS | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-320 | CAMPANHAS: CATARATA E GLAUCOMA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-323 | CAMPANHA RH | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-325 | BUSCA ATIVA ANALITICA POR RESPOSTA | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-326 | BUSCA ATIVA ANALITICA POR DATA DE RESPOSTA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-328 | RANKING POR TIPO DE RESPOSTA | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-329 | INDICADORES - BUSCA ATIVA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-336 | AME JALES - POS CIRURGICO | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-338 | CAMPANHAS: EXAMES | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-38 | ALTAS ATE AS 10 HORAS - GERAL | component | Não | INTERNACAO_USUARIO | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-39 | ALTAS ATE AS 10 HORAS - META | report | Não | ATENDIMENTOS_PS, CIRURGIAS, INTERNACAO_USUARIO, PARECER, PARECER_ATENDIMENTOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-40 | INDICADORES MEDICOS | report | Sim | ATENDIMENTOS, EXAMES, INTERNACAO_USUARIO, PARECER, PARECER_ATENDIMENTOS | Oracle direto; sem snapshot persistente no handler |
| scv / legacy123-400 | FALTANTES POR ESPECIALIDADE - GERAL | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-402 | FALTANTES ANALITICA POR DATA DE RESPOSTA | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-403 | RANKING POR TIPO DE RESPOSTA - GERAL | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-404 | FALTANTES ANALITICA POR DATA DE RESPOSTA | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-41 | ALTAS ATE AS 10 HORAS - NUMERO DE ALTAS | component | Não | INTERNACAO_USUARIO | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-410 | FALTANTES ANALITICA POR DATA DE RESPOSTA | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-411 | FALTANTES ANALITICA POR DATA DE RESPOSTA | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-412 | FALTANTES POR ESPECIALIDADE | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-414 | RANKING POR TIPO DE RESPOSTA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-415 | RANKING POR TIPO DE RESPOSTA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-416 | RANKING POR TIPO DE RESPOSTA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-42 | EXAMES POR ATENDIMENTO - GERAL | component | Não | ATENDIMENTOS, EXAMES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-47 | CONSULTAS E EXAMES - NAO CONFIRMADOS | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-48 | CONSULTAS E EXAMES - CONFIRMADOS | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-49 | CONSULTAS E EXAMES - MENSAGENS NÃO ENVIADAS | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-50 | CONSULTAS E EXAMES - MENSAGENS NÃO ENVIADAS / NÃO CONFIRMADAS | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-51 | EXAMES POR ATENDIMENTO - TABELA | component | Não | ATENDIMENTOS, EXAMES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-52 | EXAMES POR ATENDIMENTO - DESEMPENHO INDIVIDUAL | component | Não | ATENDIMENTOS, EXAMES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-53 | EXAMES POR ATENDIMENTO - COMPLETO | report | Não | ATENDIMENTOS, EXAMES | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-54 | TEMPO MEDIO PERMANENCIA - GERAL | component | Não | INTERNACAO_USUARIO | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-551 | BUSCA ATIVA ANALITICA POR RESPOSTA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-552 | FALTANTES - PACIENTES IMPORTADOS | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-554 | BUSCA ATIVA POR ESPECIALIDADE | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-555 | RANKING POR TIPO DE RESPOSTA | component | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-556 | INDICADORES - BUSCA ATIVA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-557 | BUSCA ATIVA ANALITICA POR DATA DE RESPOSTA | report | Não | TBAVISOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-56 | INDICADORES MEDICOS | report | Não | ATENDIMENTOS, ATENDIMENTOS_PS, CIRURGIAS, EXAMES, INTERNACAO_USUARIO, PARECER, PARECER_ATENDIMENTOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-58 | MEDIA DE CIRURGIAS - TOTAL | component | Não | CIRURGIAS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-62 | MEDIA ATENDIMENTOS | component | Não | ATENDIMENTOS_PS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-63 | TEMPO MEDIO PERMANENCIA - ESPECIALIDADES SUS | component | Não | INTERNACAO_USUARIO | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-64 | MEDIA DE CIRURGIAS - ELETIVAS | component | Não | CIRURGIAS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-65 | MEDIA DE CIRURGIAS - URGENCIA E EMERGENCIA | component | Não | CIRURGIAS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-68 | PARECER MEDICO POR ESPECIALIDADE | component | Não | PARECER, PARECER_ATENDIMENTOS | Não implementado/habilitado como snapshot no SCV |
| scv / legacy123-80 | FPO_AIH | component | Não | FPO_AIH | Não implementado/habilitado como snapshot no SCV |

## Evidências e limites

- Catálogo atual: /opt/backups/orbita/snapshot-report-map-20261025/current_catalog.json (sem senhas).
- Configurações de coleta: collections.json na mesma pasta.
- Mapa estruturado: mapping.json; campo branch_unknown sinaliza dependência de procedure sem identificação completa de ramo; missing lista vínculos de composição ausentes.
- Legado: BASE_catalog.json, all_definitions.json e legacy_procedure_metadata_all.json em /opt/backups/orbita/reports-catalog-20261022/legacy/.
- Composição: /opt/backups/orbita/whatsreport-sql-live-20261024/layouts.json.
- Validação específica: docs/relatorios/VIDAS_SANSAUDE_VALIDACAO.md; INDICADORES_INFORMATIVOS_MAPEAMENTO.md; SNAPSHOTS_LEITOS.md; docs/VALIDACAO_CALCULOS_RELATORIOS.md.
- Metadados legados podem anteceder alterações recentes; nenhuma procedure de negócio, envio, mudança de agenda ou alteração em servidor legado foi executada.
- O mapa registra dependência e estágio técnico; não promove itens a integrados nem habilita envios.


## Validação e cadastro — 25/10/2026

Três coletas cobrem os nove consumidores históricos confirmados. Foram cadastradas Vidas e capacidade SUS/convênio e preservados os históricos reais no PostgreSQL. Fonte futura do rateio permanece bloqueada; coletas novas e relatórios finais não foram automaticamente habilitados. Ver VALIDACAO_CADASTRO_SNAPSHOTS.md e o ledger individual dos 354 cadastros em /opt/backups/orbita/snapshot-validation-20261025/validation-ledger.json.
