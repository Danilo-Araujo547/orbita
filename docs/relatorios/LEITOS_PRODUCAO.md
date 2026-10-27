# Coleta de leitos em produção — 25/10/2026

A coleta `bed-position-daily` (configuração 1) usa a conexão Oracle 1, Santa Casa `172.16.0.254:1521/prdvotu`, usuário DBAMV e senha criptografada no cadastro. Homologação 19 permanece separada; vidas e capacidade SUS/convênio não foram alteradas.

Componente 354, `Leitos · posição atual no Oracle`, mantém a query editável `bed_position.sql`. SELECT em transação somente leitura: leitos ativos, não extras, ocupação O/V/R/L, excluindo unidades 11/12/17. O total segue estes filtros e não representa exclusivamente ocupados.

Coleta diária ativa às 04:20:23 America/Sao_Paulo, todos os dias, janela de 60 minutos. Agendador Celery Beat → tick_snapshots → worker collect_snapshot. Primeira coleta manual real em 25/10/2026, execução f16da25d-3b4a-4f1f-9cd9-148491dcba83: 14 unidades, 212 leitos, PostgreSQL BedSnapshotRow. Idempotência validada: repetir não duplica linhas.

Relatório 310, Exportar tabela leitos, permanece Canvas/XLSX, uma planilha e quatro colunas. Exportação real de 25/10 validada: 14 linhas, soma 212, API Canvas 200, sem pendências. Preservadas 698 linhas legadas e as coletas de homologação, sem reclassificá-las como produção. Não se fabricaram snapshots retroativos. A seleção atual ainda exige períodos separados entre histórico legado e novas coletas; não foi alterada a regra de composição de origens.

O PDF externo `Indicadores - Painel Leitos` permanece independente e não foi reconstruído por esta troca de conexão. Nenhum envio ou programação de relatório foi habilitado. Backup das configurações anteriores e evidência: `/opt/backups/orbita/leitos-production-20261025/`.
