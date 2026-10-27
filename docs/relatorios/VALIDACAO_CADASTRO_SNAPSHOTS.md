# Validação e cadastro das coletas históricas — 25/10/2026

## Entregue

- Inventário de todos os 354 cadastros preexistentes, incluindo relatórios, componentes e rotinas. Dois componentes de coleta foram acrescentados; a classificação completa e o parecer individual estão em validation-ledger.json nas evidências.
- Nove dependências históricas confirmadas, centralizadas em três configurações de coleta; não foram criadas coletas duplicadas por relatório consumidor.
- Cadastro em Relatórios → Componentes → Coleta; query editável, vínculos de consumidores, ambiente, data de referência, programação e histórico diário/mensal.
- Históricos preservados em PostgreSQL. Nenhuma mensagem enviada e nenhum relatório final foi automaticamente habilitado por esta entrega.

| Coleta | Código | Consumidores legados | Estado |
|---|---|---|---|
| 1 — Leitos totais | bed-position-daily | 311 | Existente, automática diária 04:20:23, Oracle HML. Série de produção importada permanece separada. |
| 2 — Vidas Sansaúde | lives-daily | 310 e 271 | Query validada e primeira coleta HML de 24/10 concluída; novas coletas automáticas desativadas. Horário inicial editável 04:30, referência ontem; não representa comprovação do horário legado. |
| 3 — Capacidade SUS/convênio | bed-capacity-daily | 20, 55, 18, 19, 24, 25 | Histórico de produção importado. Coleta futura desativada/bloqueada: falta fonte equivalente ao rateio manual por ambiente. Horário inicial editável 04:25 não é prova do horário legado. |

## Dados reais preservados

| Conjunto | Períodos | Registros | Origem |
|---|---:|---|
| Leitos totais já existentes | 50 datas, 01/09 a 23/10/2026 | 698 | Histórico legado de produção; lacunas preservadas. |
| Capacidade SUS/convênio | 657 datas, 01/01/2025 a 23/10/2026 | 9.067 | LEITOS_DISPONIVEIS, reconciliados com LEITOS_SISTEMA na extração aprovada. SUS + convênio = total em todos os registros. |
| Vidas diário | 22 datas, 01 a 22/10/2026 | 124 | SAN_VIDAS, extrato legado aprovado. |
| Vidas mensal | 22 competências, 01/2025 a 10/2026 | 96 | SAN_VIDAS_MES, extrato legado aprovado. |
| Primeira coleta Vidas HML | Referência 24/10/2026 | 4 | Oracle hmlvotu; armazenada separadamente da produção. |

As 9.287 linhas desta importação de capacidade/Vidas foram reimportadas em seguida: zero duplicações. Horários históricos de coleta, programação e origem permanecem nulos quando desconhecidos. Competência mensal é identificada por period_type=month e payload.period; o primeiro dia na chave do período não é apresentado como data real de captura. Não completar lacunas com zeros ou dados atuais.

## Validação das fontes

- Oracle HML: transação somente leitura, cinco datas de Vidas comparadas à query original de cinco dias na mesma transação; igualdade integral. Chaves, datas, contratos, situações e totais inteiros conferidos.
- Leitos atuais HML: 15 setores e 219 leitos. Não é prova de equivalência com a produção.
- Firebird .123/GLDADOS: conexão exata WhatsReport 123 - Leitura salva no DBeaver, credencial usada somente em memória. MON$READ_ONLY=1 conferido. Consultados metadados, triggers e contagem de LEITOS_DISPONIVEIS; nenhuma procedure de negócio executada.
- ACS/eSUS: PROC_INDICADORES_ESUS depende de PRODUCAO_AGENTE_MENSAL. Estrutura com MES1..MES13 e títulos; trigger calcula média das primeiras 12 posições positivas. Não há chave de data de captura nessa tabela. Não confundir agregado rolante com arquivo histórico diário. SELECT de dados recusado com GDS 335544352; nenhuma permissão alterada.
- Robôs WhatsApp por unidade: metadados comprovam referência a CADASTRO_PRESTADORES_MENSAL, mas não estabelecem, sozinhos, semântica de snapshot nem validade de todos os ramos. A credencial localizada do GLDADOS não foi reutilizada em outros bancos/servidores.
- Não foram adicionadas coletas para dados Oracle operacionais reconstruíveis, metas, arquivos externos ou agregados sem prova de snapshot histórico. Esses itens continuam com parecer e pendência individuais no ledger.

## Testes e operação

- 221 testes na regressão final e 23 testes focados de datasets aprovados, incluindo granularidade, virada de mês e ano bissexto. As suítes se sobrepõem e suas contagens não devem ser somadas. Logs: regression-release.log e tests-boundaries.log.
- Cobertura: dois workers em PostgreSQL; idempotência diária e histórica; conflito sem sobrescrita; dados inválidos sem gravação parcial; isolamento de unidade e ambiente; competência mensal; revisão de SQL antes/durante a coleta; edição de query e conflito 409; transporte não chamado.
- Queries não podem executar DML. Configuração HML não pode ser reetiquetada como produção usando hmlvotu. Fonte sem rateio validado não pode ser coletada nem habilitada.
- Backup PostgreSQL anterior às migrations: postgres-before.dump nas evidências. Migrations aditivas; histórico de leitos e execução XLSX anterior conferidos após a atualização.
- API e painel publicados; agenda e transportes existentes preservados. Testes reais foram feitos sem destinatários, sem entrega de relatórios e sem alterações nos servidores legados.

## Caminhos

- Código: operations/snapshot_datasets.py, legacy_snapshot_datasets.py, bed_snapshots.py, snapshot_api.py e migration 0028_snapshot_datasets.py.
- Cadastro idempotente: python manage.py register_snapshot_datasets --unit scv --connection-id 19 --actor admin. A query personalizada existente não é sobrescrita.
- Evidências: /opt/backups/orbita/snapshot-validation-20261025/.
- Ledger completo: validation-ledger.json; leitura Firebird: firebird-live-metadata.json; conferência de importação: snapshot-import-verification.json; Oracle: oracle-validation.log.
- API de histórico aceita environment=production/homologation e period_type=day/month. Registros de leitos mantêm o formato anterior; outros conjuntos retornam record_key e payload agregado.
