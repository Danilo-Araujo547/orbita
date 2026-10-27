# Migração das variantes SIGS para Canvas

Concluída em 25/10/2026. São 29 registros existentes: 14 consultas por unidade, 13 saídas de medicamentos por farmácia e duas listas de gestantes. Fonte Oracle SIGS `172.16.2.254:1521/prdpmv`, conexão 6. Não utiliza Firebird. Não confundir este lote com as composições 55/56 ainda pendentes.

## Validação e estado operacional

Cada SQL candidato foi executado e comparado com o SQL legado recuperado, na mesma transação Oracle somente leitura, usando igualdade de todas as colunas e multiplicidade de linhas. As consultas usam 01–25/10/2026 (dia final completo); medicamentos outubro/2026; gestantes situação atual sem parâmetros. Cada PDF foi gerado pelo Canvas, com contagem de registros e integridade confirmadas. Conferência visual representativa por família (consultas Pro Povo, medicamentos Carobeiras e gestantes Carobeiras). Não foi prometida reprodução gráfica do PDF legado.

Mantidos filtros fixos por unidade/farmácia, parâmetros e permissões anteriores. Permissão manual de Danilo -- STI cadastrada conforme instrução permanente, sem habilitar automações. Os 29 relatórios permanecem desativados para envio, revisados e com Canvas habilitado como gerador. Nenhum ReportExecution foi criado pelo processo; nenhuma mensagem foi enviada.

O comando `migrate_sigs_variants` preserva definições personalizadas, valida isolação de unidade e falhas de exportação, evita alteração durante execuções pendentes/em andamento, realiza migração por transação e é idempotente. Diferenças de quebra de linha CRLF/LF são normalizadas apenas para identificar o SQL original; nenhuma mudança semântica é ignorada. Consultas e layouts são versionados no cadastro. Backups anteriores e PDFs com acesso restrito em `/opt/backups/orbita/sigs-variants-migration-20261025/`.

Regressão: 115 testes aprovados, incluindo filtros das 29 variantes, rollback, proteção contra consultas personalizadas, idempotência e isolação de unidade.

## Resultados

| Código | Relatório | Registros | Páginas PDF | Estado |
|---|---|---:|---:|---|
| legacy123-266 | RELATORIO DE CONSULTAS - CM PRO POVO | 6 | 1 | Integrado Canvas; envio desativado |
| legacy123-276 | RELATORIO DE CONSULTAS - CM JARDIM MARIN | 7 | 1 | Integrado Canvas; envio desativado |
| legacy123-277 | RELATORIO DE CONSULTAS - CM SAO JOAO | 6 | 1 | Integrado Canvas; envio desativado |
| legacy123-278 | RELATORIO DE CONSULTAS - CM PALMEIRAS | 8 | 1 | Integrado Canvas; envio desativado |
| legacy123-279 | RELATORIO DE CONSULTAS - CM COLINAS | 5 | 1 | Integrado Canvas; envio desativado |
| legacy123-280 | RELATORIO DE CONSULTAS - CM VILA AMERICA | 8 | 1 | Integrado Canvas; envio desativado |
| legacy123-281 | RELATORIO DE CONSULTAS - CM CECAP | 6 | 1 | Integrado Canvas; envio desativado |
| legacy123-282 | RELATORIO DE CONSULTAS - CM CAROBEIRAS | 7 | 1 | Integrado Canvas; envio desativado |
| legacy123-283 | RELATORIO DE CONSULTAS - CM SAO COSME | 6 | 1 | Integrado Canvas; envio desativado |
| legacy123-284 | RELATORIO DE CONSULTAS - CM SIMONSEN | 6 | 1 | Integrado Canvas; envio desativado |
| legacy123-285 | RELATORIO DE CONSULTAS - CM PARQUE DAS NACOES | 7 | 1 | Integrado Canvas; envio desativado |
| legacy123-286 | RELATORIO DE CONSULTAS - CM VILA PAES | 10 | 1 | Integrado Canvas; envio desativado |
| legacy123-287 | RELATORIO DE CONSULTAS - CM NINA | 9 | 1 | Integrado Canvas; envio desativado |
| legacy123-290 | RELATORIO SAIDA DE MEDICAMENTOS - CAROBEIRAS | 194 | 7 | Integrado Canvas; envio desativado |
| legacy123-292 | RELATORIO GESTANTES - CM  CAROBEIRAS | 19 | 2 | Integrado Canvas; envio desativado |
| legacy123-293 | RELATORIO GESTANTES - CM  PRO POVO | 47 | 3 | Integrado Canvas; envio desativado |
| legacy123-294 | RELATORIO SAIDA DE MEDICAMENTOS -  PRO POVO | 234 | 8 | Integrado Canvas; envio desativado |
| legacy123-296 | RELATORIO SAIDA DE MEDICAMENTOS - JARDIM MARIN | 253 | 9 | Integrado Canvas; envio desativado |
| legacy123-297 | RELATORIO SAIDA DE MEDICAMENTOS -  SAO JOAO | 258 | 9 | Integrado Canvas; envio desativado |
| legacy123-298 | RELATORIO SAIDA DE MEDICAMENTOS -  PALMEIRAS | 234 | 8 | Integrado Canvas; envio desativado |
| legacy123-299 | RELATORIO SAIDA DE MEDICAMENTOS -  COLINAS | 213 | 8 | Integrado Canvas; envio desativado |
| legacy123-300 | RELATORIO SAIDA DE MEDICAMENTOS -  VILA AMERICA | 221 | 8 | Integrado Canvas; envio desativado |
| legacy123-301 | RELATORIO SAIDA DE MEDICAMENTOS -  CECAP | 231 | 8 | Integrado Canvas; envio desativado |
| legacy123-302 | RELATORIO SAIDA DE MEDICAMENTOS -  SAO COSME | 195 | 7 | Integrado Canvas; envio desativado |
| legacy123-303 | RELATORIO SAIDA DE MEDICAMENTOS -  SIMONSEN | 185 | 7 | Integrado Canvas; envio desativado |
| legacy123-304 | RELATORIO SAIDA DE MEDICAMENTOS -  PARQUE DAS NACOES | 209 | 7 | Integrado Canvas; envio desativado |
| legacy123-305 | RELATORIO SAIDA DE MEDICAMENTOS -  VILA PAES | 246 | 9 | Integrado Canvas; envio desativado |
| legacy123-306 | RELATORIO SAIDA DE MEDICAMENTOS - NINA | 256 | 9 | Integrado Canvas; envio desativado |
| legacy123-321 | RELATORIO DE CONSULTAS - DENGARIO | 0 | 1 | Integrado Canvas; envio desativado |

## Semântica preservada

Consultas por unidade não possuem a coluna equipe da consulta geral. UNSA_COD restringe a unidade executante e UNIDADE_SOLICITANTE é a dimensão exibida, podendo ter outro nome. A data é a de agendamento; atendimento concluído não é exigido pela view. Dengário (321) não retornou linhas neste recorte; PDF sem linhas de dados é o resultado esperado, não falha de integração.

Medicamentos recebe ano e mês, não duas datas; mês restrito a 1–12. Preservados nomes literais de estoque, incluindo CECAP II e ESF V/Nina. Quantidades e valores mantêm precisão do Oracle. A view inclui saídas NAO_CONFIRMADO e CONFIRMADO_COM_PENDENDECIA conforme regra legada; não foi introduzido novo filtro.

Gestantes preserva situação atual da view e código de unidade de referência. Pode haver pré-natal INATIVO ou datas antigas quando o cadastro de gestante satisfaz os demais filtros; isso foi preservado, não corrigido por hipótese. Revisão da qualidade do cadastro não é parte da equivalência do SQL.

Datas futuras, períodos maiores e envio por WhatsApp não foram homologados por este lote. Permanece o limite de 10.000 linhas da conexão, tamanho e páginas do Canvas; resultados acima dos limites são recusados integralmente.

Planilha principal atualizada: https://docs.google.com/spreadsheets/d/13aQJVPIKGuBpi94uvPoQiA0SQo_14NrMDZijqec_YLM/edit — aba Acompanhamento. Atualizar sempre a planilha após avanços, sem substituir pelo markdown local.
