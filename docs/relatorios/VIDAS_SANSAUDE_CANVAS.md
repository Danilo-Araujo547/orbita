# Vidas Sansaúde — integração Canvas

Validação: 26/10/2026. Unidade SCV.

## Cadastros distintos

- `legacy123-310` (ID 309), INDICADORES - VIDAS SANSAUDE: integrado no Canvas, PDF de duas páginas, cadastro revisado. Permanece desativado para envios. Permissão manual cadastrada para Danilo -- STI; sem permissão automática.
- `legacy123-269` (ID 271), INDICADORES VIDAS SANSAUDE: arquivo externo original `C:\Controladoria\Sansaude\VIDAS_SANSAUDE.pdf` não recuperado. Continua desativado e com alerta. A reconstrução 310 não comprova o gerador desse arquivo.

## Fontes e períodos

1. Histórico de produção importado do legado no PostgreSQL: 22 competências mensais (96 linhas) e 22 datas diárias (124 linhas). A seleção exige mesma unidade, dataset lives, estado ready, origem legacy, kind legacy_import e environment production. Coletas de homologação não entram no PDF.
2. Datas diárias sem fotografia: componente `vidas-sansaude-production-oracle` (ID 365), conexão Oracle produção `prdvotu` (ID 1), consulta recuperada do sincronizador, somente leitura, bind `data_alvo`. O PDF identifica a quantidade de datas reconstruídas; o dataset origins identifica cada período. Uma consulta retrospectiva atual não se torna fotografia histórica original. Não grava novos snapshots.
3. Metas: 24 competências de 2025/2026 preservadas em ReportDefinition.monthly_goals; o gerador consome a fotografia da execução. Manutenção pelo cadastro do SCV. Não consulta Firebird em tempo de geração.

Referência opcional data_referencia; padrão hoje. Corte no dia anterior: dois anos de posição, 13 competências e 10 datas recentes. O ano anterior usa dezembro; o atual usa a mesma posição do dia de corte. Não soma meses para formar vidas anuais. Contratos E/I/A incluem grupos elegíveis S e N; excluir N alteraria a equivalência. Falta de grupo, duplicidade, ausência de histórico/meta e valores inválidos bloqueiam a geração.

A coleta lives-daily de homologação permanece desativada e inalterada. Programação automática do PDF é bloqueada até homologação específica.

## Resultado validado

- Referência 23/10/2026: 12 competências fechadas conferidas, posição de 22/10 em 18.539, nenhuma data reconstruída.
- Referência 26/10/2026: corte 25/10, total 18.577 (Empresarial 15.364, Individual 2.282, Adesão 931), três datas reconstruídas (23 a 25/10), duas páginas.
- Fevereiro/2026 validado em 17.535; corrige transcrição anterior de 17.635.
- A diferença de duas vidas em Individual de 20/10 entre PDF antigo e fotografia posterior permanece registrada; não foi apagada nem apresentada como equivalência integral.
- Layout refeito em Canvas, com gráficos e tabelas; não é cópia pixel a pixel do arquivo externo original.
- Testes: períodos/virada anual, somas S/N, histórico/metas ausentes, proveniência, bloqueio automático, duas páginas, coleta única e conexão/unidade inválidas. 46 testes aprovados. Resultado final em tests-final.log.

Evidências restritas: /opt/backups/orbita/lives-canvas-20261026/ (before.json, validated.json, PDF e testes). Nenhuma mensagem enviada ou escrita no banco legado/Oracle.

## Planilha compartilhada

A atualização deve ocorrer somente via API. Nesta sessão o conector Google Drive está indisponível. O cadastro de código legacy123-310 deve receber status integrado técnico, Canvas/Oracle produção + histórico PG, com a ressalva de reconstrução retrospectiva. O código legacy123-269 continua pendente. A publicação do relatório não equivale à atualização da planilha compartilhada.

## Publicação conferida

API, worker e scheduler publicados no servidor 172.16.0.59. Prévia pelo endpoint Canvas e consulta da configuração retornaram 200; PDF de duas páginas e readiness sem pendências. Health público 200. As verificações não criaram trabalho de envio. Atualização da planilha preparada em planilha-patch-pendente.json, ainda não aplicada por falta do conector API.

## Planilha atualizada pela API — 26/10/2026

Conector Google Drive reconectado. Acompanhamento: linha 30 (legacy123-310) marcada integrada Canvas; linha 87 (legacy123-269) mantida pendente e diferenciada da reconstrução. Valores relidos e confirmados pela API; nenhuma edição via navegador. Esta atualização encerra a pendência de acesso descrita acima.
