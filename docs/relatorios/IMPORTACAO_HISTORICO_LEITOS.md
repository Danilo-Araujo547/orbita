# Histórico real de leitos — últimos 30 dias

Origem: Firebird 172.16.0.123, C:\WhatsReport\Servidor\BD\GLDADOS.FDB, LEITOS_SISTEMA. Extração de leitura de 24/09/2026 a 23/10/2026, diretamente do legado em 24/10/2026. Não são dados simulados nem consultas atuais repetidas no passado.

## Cobertura

28 dias com posições reais, 390 registros por unidade de internação. Não existem registros em 04/10 e 10/10/2026, tanto em LEITOS_SISTEMA quanto em LEITOS_DISPONIVEIS. Os 153 registros sobrepostos ao arquivo histórico anterior coincidem integralmente.

Evidência original: `/opt/backups/orbita/bed-snapshots-20261024/legacy-real-last30.json`, SHA-256 `ed053036e2e5466da9b811563e3ffdffe9c851b7093682efab9d2d83e1b2bff8`. A verificação da tabela derivada está em `legacy-missing-days-derived.json`.

## Persistência

Usa ReportSnapshotRun e BedSnapshotRow na configuração SCV 1. A identidade histórica é separada da coleta Oracle HML atual: origin=legacy, environment=production e dataset_key calculado a partir da unidade e origem física. source_snapshot registra origem, checksum do arquivo, hash das linhas e ausência de horário de captura. As duas datas sem dados são runs missed, erro legacy_snapshot_unavailable, sem linhas.

O horário histórico original não é recuperável pelo campo DATA, cujo trigger zera a hora. captured_at, source_at do run e scheduled_for ficam nulos. requested_at/completed_at registram a importação atual; não são apresentados como horário original. A data das linhas permanece igual à do legado.

Reimportar dados iguais não duplica snapshots ou linhas. Divergência com uma snapshot já preservada aborta toda a importação. Uma lacuna só pode ser substituída por dados reais que sejam recuperados depois, nunca por valores atuais.

## Consulta e exportação

No mesmo EXPORTAR TABELA LEITOS, informar o período histórico. Os parâmetros continuam sendo somente data inicial e final. Um período que só contenha histórico legado usa essa origem. Períodos que reúnam legado de produção e Oracle HML são bloqueados; consultar separadamente.

Para o legado, a exportação reproduz a seleção original: linhas existentes no período, sem preencher lacunas ou inventar zeros. A execução informa missing_dates e a tela mostra quantas datas estão ausentes. O XLSX mantém as quatro colunas e usa o sufixo Legado no nome. Feedback WhatsApp, quando o usuário pedir e os controles permitirem, identifica origem de produção e lacunas. Importar/coletar não envia mensagens.

Na aba Coletas → Histórico, registros legacy aparecem como Legado/Produção e as lacunas como Sem registro no legado. A coleta automática atual continua em homologação e não é alterada.

Consulta PostgreSQL equivalente:

```sql
SELECT b.ward_code AS "CD_UNID_INT", b.ward_name AS "DS_UNID_INT",
       b.quantity AS "QUANTIDADE", r.reference_date::timestamp AS "DATA"
FROM operations_bedsnapshotrow b
JOIN operations_reportsnapshotrun r ON r.id = b.run_id AND r.unit_id = b.unit_id
WHERE r.configuration_id = 1 AND r.origin = 'legacy' AND r.state = 'ready'
  AND r.reference_date BETWEEN DATE '2026-09-24' AND DATE '2026-10-23'
ORDER BY r.reference_date, b.ward_code;
```

## Manutenção

Migration operations.0026_legacy_snapshot_unknown_schedule torna scheduled_for anulável para não inventar a hora histórica. Preserva a migration 0025 de metas adicionada por outro trabalho.

`python manage.py import_legacy_bed_snapshots --unit scv --configuration 1 --file /caminho/legacy-real-last30.json --actor admin`

O comando trabalha apenas no PostgreSQL e no arquivo de evidência. Não executa procedures nem grava dados no Firebird. Na preparação do acesso, foi concedido SELECT apenas em LEITOS_SISTEMA e LEITOS_DISPONIVEIS ao usuário SCV_DBEAVER_20261024; a conta e o mapeamento administrativos temporários foram removidos, sem reiniciar o serviço.

## Validação executada no remoto

Importação real concluída, seguida de reimportação idempotente: zero novos dias, 28 dias preservados. PostgreSQL contém 30 runs históricos: 28 ready, dois missed e 390 linhas. A snapshot HML atual permanece separada e a coleta automática continua ativa.

Execução de exportação `acd2c835-94da-4ff3-9f59-62c2148e7cf2`, para 24/09 a 23/10: ready, XLSX com 390 linhas, quatro colunas e 28 datas. Download HTTP 200; missing_dates informa 2026-10-04 e 2026-10-10; sem destinatário e delivery_state=not_requested.

147 testes relacionados aprovados; TypeScript/Vite compilados; OpenAPI validado sem erros. O aviso de nomes ConfigurationInput duplicados é preexistente.


## Complemento — planilha original inteira

Após a confirmação do usuário, também foi importada a planilha original EXPORTAR_TABELA_LEITOS.xlsx inteira: 461 registros de 01/09 a 05/10/2026, SHA-256 06ac3d7910ba024d7d14db9df82c779a10c03dfdbceb6381009e5ed651eff6b0. Os 153 registros sobrepostos já estavam preservados; foram acrescentados 22 dias/308 registros, sem duplicação ou alteração dos dados existentes.

O histórico real consolidado no PostgreSQL passou a 698 registros/50 dias, de 01/09 a 23/10, com lacunas reais em 20/09, 04/10 e 10/10. A snapshot HML de 24/10 continua separada. A geração do relatório histórico lê exclusivamente ReportSnapshotRun/BedSnapshotRow no PostgreSQL. Oracle é apenas origem da coleta nova; a geração não acessa Oracle nem Firebird.

Verificação real: execução 634d572b-de54-450f-9a6c-23074eea4ca1 gerou 461 linhas para o mesmo período da planilha original; todas as quatro colunas e todos os valores coincidiram exatamente. As funções de consulta/conexão externa foram bloqueadas durante essa validação e não foram chamadas. Sem destinatário nem envio.

Artefatos em /opt/backups/orbita/bed-snapshots-20261024/: EXPORTAR_TABELA_LEITOS_ORIGINAL.xlsx e legacy-original-spreadsheet.json.
