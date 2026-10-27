# Origens das bases legadas da instalação 172.16.0.123

Localizações obtidas de TBBASES, decodificando somente tipo, endereço, banco, porta e nome. Nenhum usuário ou senha foi selecionado. Alias Oracle conferidos no tnsnames.ora. Fontes configuradas não equivalem a conexões testadas.

| Base | Origem | Servidor | Banco/arquivo | Relatórios diretos |
|---|---|---|---|---|
| 1 | SANTA CASA VOTUPORANGA (ORACLE) | 172.16.0.254:1521 | `prdvotu` | 17 |
| 2 | AME VOTUPORANGA (ORACLE) | 172.19.0.250:1521 | `prdamevo` | 2 |
| 3 | MEGA ONLINE (FIREBIRD) | 172.16.0.123:3050 | `C:\WhatsReport\Servidor\BD\gldados.fdb` | 128 |
| 4 | ROB8 RELATORIO GESTORES (FIREBIRD) | 172.16.0.123:3050 | `C:\WhatsReport\Servidor\BD\base.fdb` | 3 |
| 5 | AME JALES (ORACLE) | Pendente:? | `Pendente` | 0 |
| 6 | AME SANTA FÉ DO SUL (ORACLE) | 172.17.0.254:1521 | `PRODUCAO_SFS` | 0 |
| 7 | ROB8 MENSAGENS CONFIRMACAO CONSULTAS E EXAMES (FIREBIRD) | 172.19.0.123:3050 | `c:\whatsreport\servidor\bd\base.fdb` | 11 |
| 8 | SANSAUDE (FIREBIRD) | 172.16.0.124:3050 | `c:\whatsreport\servidor\bd\base.fdb` | 6 |
| 9 | NAS UBS (FIREBIRD) | 10.2.74.70:3050 | `C:\WhatsReport\Servidor\BD\base.fdb` | 63 |
| 10 | AME JALES ROB8 (FIREBIRD) | 172.18.0.123:3050 | `C:\WhatsReport\Servidor\BD\base.fdb` | 9 |
| 11 | AME SANTA FE ROB8 (FIREBIRD) | 172.17.200.21:3050 | `C:\WhatsReport\Servidor\BD\base.fdb` | 5 |
| 13 | ESUS - SERVIDOR (POSTGRESS) | 167.249.56.126:54330 | `esus` | 3 |
| 14 | ESUS - TERMINAL (FIREBIRD) | 172.16.0.123:3050 | `C:\WhatsReport\Servidor\BD\gldados_esus.fdb` | 1 |
| 15 | USUARIO - SANTA CASA VOTUPORANGA (ORACLE) | 172.16.0.254:1521 | `prdvotu` | 0 |
| 17 | USUSRIO - SIGS (ORACLE) | 172.16.2.254:1521 | `prdpmv` | 37 |
| 19 | AME VOTUPORANGA ROB8 (FIREBIRD) | 172.19.0.123:3050 | `c:\whatsreport\servidor\bd\base.fdb` | 11 |
| 21 | ROB8 - NAS (FIREBIRD) | 10.2.74.70:3050 | `C:\WhatsReport\Servidor\BD\base.fdb` | 15 |
| 22 | AME VOTUPORANGA ORTOPEDIA (FIREBIRD) | 172.16.0.127:9020 | `C:\WhatsReport\Servidor\BD\base.fdb` | 0 |

## Legado 1 · Oracle Santa Casa · prdvotu

ORACLE — SANTA CASA VOTUPORANGA. Origem configurada: 172.16.0.254:1521; banco/arquivo: prdvotu. Conexão de origem do hospitalar; relatórios e sincronizações dependem das definições vinculadas.

Método: Conexão Oracle via alias TNS. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: SINCRONIZAR, dbamv.vdic_mges_033

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): DBAMV, DBAMV.ATENDIME, DBAPS.DESLIGAMENTO, DBAPS.USUARIO, Dbamv.Ent_pro, Dbamv.Mvto_Estoque, ORGANIZA_GRUPO_PROCEDIMENTOS, Procedimento_Sus, SUB_GRUPO_PROCEDIMENTOS, atendime, dbamv, dbamv.itmvto_ent, dbamv.par_med, dbamv.procedimento_sus_complexidade, dbamv.remessa_apac, dbamv.remessa_bpa, dbamv.set_exa, dbamv.v_ffis_valor_conta_aih, dbasistemas.vdic_cons_agenda_envio_msg_san, eve_siasus, fat_sia, grupo_procedimentos, leito, ori_ate, procedimento_sus, procedimento_sus_complexidade, unid_int

## Legado 2 · Oracle AME Votuporanga · prdamevo

ORACLE — AME VOTUPORANGA. Origem configurada: 172.19.0.250:1521; banco/arquivo: prdamevo. Conexão de origem do hospitalar; relatórios e sincronizações dependem das definições vinculadas.

Método: Conexão Oracle via alias TNS. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: SINCRONIZAR_ROB8

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): dbasistemas.tbl_log_mega_msg, dbasistemas.vdic_consulta_agenda_envio_msg, dbasistemas.vdic_exame_agenda_envio_msg

## Legado 3 · Firebird local · indicadores e cache hospitalar

FIREBIRD — MEGA ONLINE. Origem configurada: 172.16.0.123:3050; banco/arquivo: C:\WhatsReport\Servidor\BD\gldados.fdb. Cache e apuração local. Os sincronizadores 59 e 61 contêm consultas Oracle da base 1 e rotinas de preparação/limpeza na base 3. Indicadores usam PROC_RESUMO_ATENDIMENTOS, PROC_ALTAS_ATE_AS_10 e PROC_EXAMES_POR_ATENDIMENTO. Os fontes textuais dessas três procedures estão ausentes. PDFs de Controladoria são arquivos externos, não uma consulta Oracle produzida por essa conexão.

Método: Conexão Firebird local pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: PROC_ALTAS_ATE_AS_10, PROC_FPO, PROC_LEITOS_DISPONIVEIS, PROC_LIMPAR_ATENDIMENTOS, PROC_LIMPAR_EXAMES, PROC_LIMPAR_FPO_AMB_AIH, PROC_LIMPAR_INTERNACAO_USUARIO, PROC_LIMPAR_PACIENTES_DIA, PROC_LIMPAR_PRODUCAO_AGENTE, PROC_RESUMO_ATENDIMENTOS, SINCRONIZAR, proc_altas_ate_as_10, proc_exames_por_atendimento, proc_indicadores_esus

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): CADCLI, FPO_AIH, leitos_sistema

## Legado 4 · Firebird local · WhatsReport e gestores

FIREBIRD — ROB8 RELATORIO GESTORES. Origem configurada: 172.16.0.123:3050; banco/arquivo: C:\WhatsReport\Servidor\BD\base.fdb. Banco local do WhatsReport; não confundir com GLDADOS.FDB. Regras de consulta e execução dependem do cadastro de cada relatório.

Método: Conexão Firebird local pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: PROC_ALTERAR_PRODUCAO_ACS, PROC_LIMPAR_CONSULTAS_MEDICAS, PROC_LIMPAR_EXAMES_MEDICAS

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Legado 5 · Oracle AME Jales · destino não informado

ORACLE — AME JALES. Origem configurada: host não identificado:porta não informada; banco/arquivo: não informado. O cadastro existe, mas DATABASE, SERVER e PORT estão vazios. O arquivo TNS contém PRODUCAO_JLS -> 172.18.0.254:1521/prdameja; não há vínculo preenchido nesta base que prove seu uso.

Método: Destino incompleto. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: Nenhuma nesta base, no catálogo.

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Legado 6 · Oracle AME Santa Fé · PRODUCAO_SFS

ORACLE — AME SANTA FÉ DO SUL. Origem configurada: 172.17.0.254:1521; banco/arquivo: PRODUCAO_SFS. Conexão de origem do hospitalar; relatórios e sincronizações dependem das definições vinculadas.

Método: Conexão Oracle via alias TNS. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: Nenhuma nesta base, no catálogo.

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123

FIREBIRD — ROB8 MENSAGENS CONFIRMACAO CONSULTAS E EXAMES. Origem configurada: 172.19.0.123:3050; banco/arquivo: c:\whatsreport\servidor\bd\base.fdb. Mesmo endpoint da base 19, com cadastro separado. Onze definições ligadas a indicadores do robô; procedure proc_desempenho_equipe registrada. Consulta ao Firebird remoto pela aplicação; DBLINK não comprovado.

Método: Conexão Firebird remota pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: proc_desempenho_equipe

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): tbavisos

## Legado 8 · Firebird robô Sansaúde · 172.16.0.124

FIREBIRD — SANSAUDE. Origem configurada: 172.16.0.124:3050; banco/arquivo: c:\whatsreport\servidor\bd\base.fdb. Cadastro do robô Sansaúde. A origem hospitalar que alimenta esse robô não é dedutível somente deste endereço e deve ser rastreada por fluxo.

Método: Conexão Firebird remota pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: proc_desempenho_equipe

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Legado 9 · Firebird robô NAS/UBS · 10.2.74.70

FIREBIRD — NAS UBS. Origem configurada: 10.2.74.70:3050; banco/arquivo: C:\WhatsReport\Servidor\BD\base.fdb. Mesma localização da base 21. Sessenta e três definições usam esta base; procedures proc_desempenho_equipe e PROC_GESTAO_MENSAGENS cadastradas. É NAS/UBS, não AME Votuporanga.

Método: Conexão Firebird remota pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: PROC_GESTAO_MENSAGENS, proc_desempenho_equipe

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Legado 10 · Firebird robô AME Jales · 172.18.0.123

FIREBIRD — AME JALES ROB8. Origem configurada: 172.18.0.123:3050; banco/arquivo: C:\WhatsReport\Servidor\BD\base.fdb. Firebird do robô AME Jales; definições de indicadores e proc_desempenho_equipe. Não confundir com o Oracle hospitalar do AME Jales.

Método: Conexão Firebird remota pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: proc_desempenho_equipe

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): t.data, tbavisos

## Legado 11 · Firebird robô AME Santa Fé · 172.17.200.21

FIREBIRD — AME SANTA FE ROB8. Origem configurada: 172.17.200.21:3050; banco/arquivo: C:\WhatsReport\Servidor\BD\base.fdb. Firebird do robô AME Santa Fé; indicadores e proc_desempenho_equipe. Não confundir com o alias Oracle PRODUCAO_SFS.

Método: Conexão Firebird remota pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: proc_desempenho_equipe

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Legado 13 · PostgreSQL eSUS · 167.249.56.126

POSTGRESS — ESUS - SERVIDOR. Origem configurada: 167.249.56.126:54330; banco/arquivo: esus. Origem PostgreSQL eSUS. Definições 164 e 259 referenciam PRODUCAO_AGENTE_15_DIAS e PRODUCAO_AGENTE_35_DIAS; cadastro 317 referencia AGENDA_ESUS_2_DIAS. O uso exato desses objetos e o destino de cada sincronização ainda exigem leitura das definições.

Método: Conexão PostgreSQL da aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: SINCRONIZAR, SINCRONIZAR_ROB8

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Legado 14 · Firebird local · terminal eSUS

FIREBIRD — ESUS - TERMINAL. Origem configurada: 172.16.0.123:3050; banco/arquivo: C:\WhatsReport\Servidor\BD\gldados_esus.fdb. Arquivo local GLDADOS_ESUS.FDB. Cadastro 173 lê SELECT * FROM PRODUCAO_AGENTE_ESUS com marcador SINCRONIZAR. A transferência completa entre PostgreSQL, esse cache e indicadores requer confirmação adicional.

Método: Conexão Firebird local pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: SINCRONIZAR

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): PRODUCAO_AGENTE_ESUS

## Legado 15 · Oracle Santa Casa · conexão de usuário

ORACLE — USUARIO - SANTA CASA VOTUPORANGA. Origem configurada: 172.16.0.254:1521; banco/arquivo: prdvotu. Compartilha o alias prdvotu com a base 1. É um cadastro distinto; permissões da conta não foram inspecionadas.

Método: Conexão Oracle via alias TNS. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: Nenhuma nesta base, no catálogo.

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Legado 17 · Oracle SIGS · prdpmv

ORACLE — USUSRIO - SIGS. Origem configurada: 172.16.2.254:1521; banco/arquivo: prdpmv. Alias prdpmv confirmado no TNS. Cadastro descrito como usuário SIGS. Não foram testadas credenciais.

Método: Conexão Oracle via alias TNS. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: Nenhuma nesta base, no catálogo.

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): sigsaudej.vdic_mega_relatorios_001, sigsaudej.vdic_mega_relatorios_003, sigsaudej.vdic_mega_relatorios_004, sigsaudej.vdic_mega_relatorios_011

## Legado 19 · Firebird robô AME Votuporanga · busca ativa

FIREBIRD — AME VOTUPORANGA ROB8. Origem configurada: 172.19.0.123:3050; banco/arquivo: c:\whatsreport\servidor\bd\base.fdb. Mesmo endpoint da base 7. Onze definições, principalmente busca ativa e respostas, com SQL sobre TBAVISOS. Informação operacional do robô; equivalência no SCV Messenger pendente, sem conversão automática para Oracle.

Método: Conexão Firebird remota pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: Nenhuma nesta base, no catálogo.

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): t.data_resposta, tbavisos

## Legado 21 · Firebird robô NAS · consultas de campanhas

FIREBIRD — ROB8 - NAS. Origem configurada: 10.2.74.70:3050; banco/arquivo: C:\WhatsReport\Servidor\BD\base.fdb. Mesmo endpoint da base 9, cadastro separado. Quinze definições, incluindo campanhas e ausentes, com SQL sobre TBAVISOS. Não foi comprovado DBLINK; o cadastro aponta acesso Firebird remoto.

Método: Conexão Firebird remota pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: Nenhuma nesta base, no catálogo.

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): TBAVISOS, agendamento_ubs_faltantes, t.data_resposta, tbavisos

## Legado 22 · Firebird robô Ortopedia · 172.16.0.127

FIREBIRD — AME VOTUPORANGA ORTOPEDIA. Origem configurada: 172.16.0.127:9020; banco/arquivo: C:\WhatsReport\Servidor\BD\base.fdb. Cadastro Firebird com porta 9020, diferente das demais bases remotas. Nenhuma definição TBRELATORIO usa ID_BASE=22 na fotografia; pode haver uso fora do catálogo de relatórios.

Método: Conexão Firebird remota pela aplicação. DBLINK: Não identificado nos SQLs cadastrados; interior das procedures não auditado.

Procedures/rotinas cadastradas: Nenhuma nesta base, no catálogo.

Objetos mencionados nos SQLs (extração lexical, pode incluir aliases e ser incompleta): Não extraídos.

## Caminhos confirmados e pendências

- Indicadores hospitalares: consultas Oracle base 1 -> rotinas SINCRONIZAR dos conjuntos 59/61 -> tabelas locais GLDADOS/base 3 -> procedures de apuração -> composição/PDF. As consultas foram recuperadas, mas os fontes textuais de três procedures estão ausentes.
- Estatísticas WhatsApp AME: aplicação .123 -> conexão Firebird bases 7/19 -> 172.19.0.123/BASE.FDB -> procedures de desempenho ou SQL TBAVISOS -> relatório. Não foi demonstrado DBLINK Oracle.
- NAS/UBS: aplicação .123 -> conexão Firebird bases 9/21 -> 10.2.74.70/BASE.FDB -> procedure/SQL -> relatório.
- Arquivos externos: Excel (Estratégicos), PowerPoint (Gerenciais) e Tableau (Painel Leitos) -> PDFs em C:\Controladoria -> WhatsReport distribui. A origem dos dados desses arquivos-fonte ainda não foi recuperada.

As bases 7/19 e 9/21 são pares de cadastros para os mesmos endpoints, não bases físicas diferentes. O termo Oracle usado inicialmente nos placeholders do SCV representava um destino de migração pendente e não o tipo da origem legada. Estatísticas de mensagens/respostas exigem dados do SCV Messenger e não devem ser reconstruídas apenas do Oracle hospitalar. O ID da conexão no SCV é diferente do número ID em TBBASES; o nome e legacy_id preservam essa correspondência.

No catálogo legado, o campo PROCEDIMENTO também pode conter nomes de objetos Oracle ou caminhos de arquivos. O nome do campo não comprova que o objeto seja uma procedure. A tipagem de views/procedures Oracle permanece pendente de consulta aos metadados de origem.


## Atualização — quatro relatórios restantes, 23/10/2026

Geradores internos identificados para Vidas Sansaúde (composto 310), Exportar tabela leitos (311), Indicadores médicos (40) e Indicadores informativos (composto 20, exibido como COMPLETO TAXA OCUPAÇÃO). Ver [rastreamento detalhado](ORIGENS_RELATORIOS_PENDENTES.md).

O PDF de duas páginas fornecido para Vidas corresponde ao composto 310, com rotinas 271/308 (PROC_ALTAS_ATE_AS_10, tipos 8/9), e não ao cadastro externo 269 que aponta ao PDF ausente em C:\Controladoria. As três procedures principais têm BLR recuperado offline; seus textos PSQL originais continuam ausentes. Não considerar fórmulas ou transformações intermediárias completamente reconstruídas.
