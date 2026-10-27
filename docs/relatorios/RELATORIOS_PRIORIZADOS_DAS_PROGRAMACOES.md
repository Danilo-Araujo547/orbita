# Relatorios priorizados a partir das programacoes legadas

Atualizado em 26/10/2026. Escopo confirmado pelo usuario: **mapear e ativar somente os relatorios; nao ativar programacoes**. Nenhum destinatario ou grant sera ativado por esta priorizacao.

Inventario vivo: 50 programacoes desativadas, vinculadas a 36 cadastros: 9 relatorios integrados/ativos, 23 com integracao pendente e 4 rotinas internas preservadas/bloqueadas.

## Ja integrados e ativos

| Codigo | Relatorio | Fonte efetiva | Ressalva |
|---|---|---|---|
| legacy123-20 | COMPLETO TAXA OCUPAÇÃO | Oracle prdvotu + capacidade historica PostgreSQL + Canvas | Capacidade ate 23/10, lacunas sinalizadas; automatismos bloqueados. |
| legacy123-40 | INDICADORES MEDICOS | Oracle hmlvotu + PDF Canvas | Homologacao; nao afirmar producao. Automatismos permanecem bloqueados. |
| legacy123-53 | EXAMES POR ATENDIMENTO - COMPLETO | Oracle prdvotu + Canvas | Programacoes e permissoes preservadas. |
| legacy123-162 | INDICADORES GERENCIAIS | PDF publicado manualmente no servidor novo | Programacoes e permissoes preservadas. |
| legacy123-163 | INDICADORES ESTRATEGICOS | PDF publicado manualmente no servidor novo | Programacoes e permissoes preservadas. |
| legacy123-270 | INDICADORES INTERNACOES PS | PDF publicado manualmente no servidor novo | Ativado nesta tarefa. Copia historica preservada: datas 16 e 17/04/2026; nao representa apuracao atual. Pasta /opt/orbita/files/reports/internacoes-ps/internacoes-ps.pdf. |
| legacy123-291 | RELATORIO GESTANTES POR UNIDADE | Oracle SIGS prdpmv | Programacoes e permissoes preservadas. |
| legacy123-309 | INDICADORES - PAINEL LEITOS | PDF publicado manualmente no servidor novo | Programacoes e permissoes preservadas. |
| legacy123-310 | INDICADORES - VIDAS SANSAUDE | Oracle prdvotu + historicos/metas PostgreSQL + Canvas | Reconstrucoes historicas identificadas; nao confundir com snapshots originais. |

## Integracoes pendentes por frente

| Frente | Quantidade de relatorios | Dependencia comprovada | Trabalho para habilitar |
|---|---:|---|---|
| Producao ACS/eSUS das UBS e Geral | 14 | PROC_INDICADORES_ESUS -> PRODUCAO_AGENTE_MENSAL no Firebird .123 | Mapear a carga mensal e regras por unidade/microarea/desfecho/identificacao incompleta; preservar competencias e reproduzir calculos/layouts. Geral possui 70 partes e exige adaptador proprio. |
| Estatisticas AME Votuporanga, Jales, Santa Fe, Sansaude, NAS e Grupo Santa Casa | 6 | PROC_DESEMPENHO_EQUIPE; CADASTRO_PRESTADORES[_MENSAL], TBAVISOS, TBNUM_WHATS_AVISO/ENVIO e regras locais dos robos | Fonte dos contatos/respostas pertence aos robos; somente Oracle hospitalar nao substitui estes dados. Rastrear cada base e preservar feriados, jornadas e denominadores. |
| Consultas e exames AME Votuporanga | 2 | SQL original das views DBASISTEMAS.VDIC_CONSULTA_AGENDA_ENVIO_MSG e VDIC_EXAME_AGENDA_ENVIO_MSG + SINCRONIZAR_ROB8 | Distinguir carga de agenda do robo de relatorio final, validar contrato de dados e permissao na conexao AME. Nao executar o sincronizador. |
| Vidas Sansaúde antigo 271 | 1 | PROC_ALTAS_ATE_AS_10; dependencias incluem SAN_VIDAS, SAN_VIDAS_MES e SAN_VIDAS_METAS | Reconciliar o layout e formulas deste cadastro com o 310 ja integrado; o nome/procedure compartilhada nao comprova equivalencia. |

As localizacoes acima vem de metadados/catalogo preservados, nao de conexao validada em todos os destinos. Conexoes Oracle placeholder nao comprovam acesso aos Firebirds originais. As procedures de negocio nao foram executadas.

## Uma linha por cadastro priorizado

| Codigo | Relatorio | Situacao | Partes dependentes | Programacoes de origem (somente referencia) |
|---|---|---|---:|---|
| legacy123-20 | COMPLETO TAXA OCUPAÇÃO | integrado | 3 | 5, 6 |
| legacy123-26 | CONSULTAS_MEDICAS_AME_VOTU | integracao_pendente | 0 | 1 |
| legacy123-27 | EXAMES_MEDICOS_AME_VOTU | integracao_pendente | 0 | 2 |
| legacy123-40 | INDICADORES MEDICOS | integrado | 5 | 4, 7 |
| legacy123-53 | EXAMES POR ATENDIMENTO - COMPLETO | integrado | 2 | 9 |
| legacy123-59 | 00 - SINCRINIZAR COMPLETO PARTE 1 | rotina_interna | 15 | 3 |
| legacy123-61 | 00 - SINCRINIZAR COMPLETO PARTE 2 | rotina_interna | 4 | 10 |
| legacy123-86 | AME VOTUPORANGA - INDICADORES | integracao_pendente | 3 | 8 |
| legacy123-91 | SANSAUDE - INDICADORES | integracao_pendente | 4 | 11 |
| legacy123-102 | NAS - INDICADORES | integracao_pendente | 30 | 37 |
| legacy123-120 | AME SANTA FE - INDICADORES | integracao_pendente | 4 | 29 |
| legacy123-125 | AME JALES - INDICADORES | integracao_pendente | 4 | 30, 31, 32, 46, 48 |
| legacy123-129 | GRUPO SANTA CASA - INDICADORES | integracao_pendente | 4 | 47 |
| legacy123-162 | INDICADORES GERENCIAIS | integrado | 0 | 12 |
| legacy123-163 | INDICADORES ESTRATEGICOS | integrado | 0 | 13, 41, 45, 49 |
| legacy123-167 | UBS VILA PAES - PRODUÇÃO ACS | integracao_pendente | 5 | 28 |
| legacy123-175 | UBS GERAL - PRODUÇÃO ACS | integracao_pendente | 72 | 15 |
| legacy123-194 | UBS CAROBEIRAS - PRODUÇÃO ACS | integracao_pendente | 5 | 16 |
| legacy123-199 | UBS CECAP - PRODUÇÃO ACS | integracao_pendente | 5 | 17 |
| legacy123-204 | UBS COLINAS - PRODUÇÃO ACS | integracao_pendente | 5 | 18 |
| legacy123-209 | UBS DONA NINA - PRODUÇÃO ACS | integracao_pendente | 5 | 19 |
| legacy123-214 | UBS PAINEIRAS - PRODUÇÃO ACS | integracao_pendente | 5 | 20 |
| legacy123-219 | UBS PALMEIRAS - PRODUÇÃO ACS | integracao_pendente | 5 | 21 |
| legacy123-224 | UBS PARQUE DAS NACOES - PRODUÇÃO ACS | integracao_pendente | 5 | 22 |
| legacy123-229 | UBS PRO-POVO - PRODUÇÃO ACS | integracao_pendente | 5 | 23 |
| legacy123-234 | UBS SAO COSME - PRODUÇÃO ACS | integracao_pendente | 5 | 24 |
| legacy123-239 | UBS SAO JOAO - PRODUÇÃO ACS | integracao_pendente | 5 | 25 |
| legacy123-244 | UBS SIMONSEN - PRODUÇÃO ACS | integracao_pendente | 5 | 26 |
| legacy123-249 | UBS VILA AMERICA - PRODUÇÃO ACS | integracao_pendente | 5 | 27 |
| legacy123-257 | ESUS - SINCRONIZAR COMPLETO | rotina_interna | 3 | 14 |
| legacy123-258 | ALTERAR MES PRODUCAO ACS | rotina_interna | 0 | 38 |
| legacy123-270 | INDICADORES INTERNACOES PS | integrado | 0 | 34 |
| legacy123-271 | VIDAS SANSAUDE | integracao_pendente | 0 | 44 |
| legacy123-291 | RELATORIO GESTANTES POR UNIDADE | integrado | 0 | 36 |
| legacy123-309 | INDICADORES - PAINEL LEITOS | integrado | 0 | 39, 40, 42, 43, 50 |
| legacy123-310 | INDICADORES - VIDAS SANSAUDE | integrado | 2 | 33, 35 |

## Rotinas internas

59/61 (sincronizacoes completas), 257 (sincronizacao eSUS) e 258 (alteracao de competencia ACS) ficam bloqueadas. A classificacao cadastral ou permissao antiga nao autoriza executa-las como SELECT.

## Evidencias

`/opt/backups/orbita/prioridade-relatorios-programados-20261026T141526Z` contem backup, mapa completo de dependencias por codigo/base/procedure, testes e conferencia das configuracoes protegidas. O mapa nao inclui telefones, dados de pacientes ou segredos.

Internacoes PS: 72 testes do leitor/seguranca/download aprovados. Validacao normal API/worker sem destinatario; nenhuma mensagem ou programacao ativada.
