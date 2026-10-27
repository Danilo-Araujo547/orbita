# Validação dos relatórios SIGS — 25/10/2026

Conexão Oracle 6, 172.16.2.254:1521/prdpmv, usuário SIGSAUDEJ. Credenciais somente no cadastro criptografado. As quatro views têm 46 dependências diretas do tipo TABLE, sem DBLINK. Não há dependência de Firebird nessas definições consultadas.

| Código | Relatório | Período | Linhas | Páginas PDF Canvas |
|---|---|---|---:|---:|
| legacy123-265 | 268 | {"WPA_DATA_INICIAL": "2026-10-01", "WPA_DATA_FINAL": "2026-10-25"} | 753 | 38 |
| legacy123-272 | 274 | {"WPA_DATA_INICIAL": "2026-10-01", "WPA_DATA_FINAL": "2026-10-25"} | 257 | 11 |
| legacy123-289 | 289 | {"WPA_DATA_INICIAL": 2026, "WPA_DATA_FINAL": 10} | 3818 | 141 |
| legacy123-291 | 291 | {} | 451 | 30 |
| legacy123-312 | 311 | {"WPA_DATA_INICIAL": "2026-10-01", "WPA_DATA_FINAL": "2026-10-07"} | 1167 | 78 |

## Critério aplicado

Cada consulta cadastrada foi executada em transação Oracle somente leitura e comparada, incluindo duplicidades e todas as colunas, ao SQL legado recuperado. Nos três relatórios por intervalo, o último dia foi explicitamente incluído por inteiro. As duas consultas de consulta e a de exames já recebem datas truncadas ao dia nas views. Não foi alegada comparação com PDFs legados, nem homologação de períodos não testados.

Os cinco cadastros foram marcados como revisados e passaram para geração pelo Canvas, preservando o estado desativado. Nenhuma programação ou envio foi habilitado. As queries continuam editáveis nos registros existentes.

## Regras de negócio confirmadas no texto das views

- Consultas (265/272): DT_ATENDIMENTO é a data do agendamento `AGCO_DATA`, não a data real de atendimento. Exclui agendas marcadas como excluídas, faltantes ou canceladas. O vínculo com atendimento é LEFT JOIN e não exige que o atendimento exista. Conta agendamentos distintos por grupo; somar grupos não equivale necessariamente à contagem global distinta.
- Medicamentos (289): ano e mês são inteiros, não intervalo de datas. A view inclui estados CONFIRMADO, NAO_CONFIRMADO e CONFIRMADO_COM_PENDENDECIA, tipos FARMA/PADRAO, excluindo saídas/itens excluídos e estornos. Não alteramos esses filtros herdados. Valores unitários têm precisão original do banco.
- Gestantes (291): situação atual, sem parâmetros e sem snapshot. Gestante ATIVO, sem desfecho no pré-natal e registros não excluídos. Não significa uma linha única por paciente: vínculos do pré-natal podem gerar mais de uma linha.
- Exames (312): apenas unidades 107-1 e 105-1, observação preenchida e requerimentos não excluídos, conforme o legado.

## Limites e verificações

O limite da conexão foi elevado de 1.000 para 10.000 linhas para não descartar silenciosamente os relatórios mensais. Permanecem os limites de tempo, tamanho, 200 páginas e SELECT somente leitura. O PDF de exames em 01–25/10/2026 excede 200 páginas; foi recusado integralmente. A validação concluída cobre 01–07/10/2026, com 1.167 linhas completas. Períodos maiores podem exigir divisão em períodos menores.

Foram acrescentadas validações de mês 1–12, ano e data final não anterior à inicial na execução. O parser de respostas individuais do WhatsApp valida o tipo/limite do campo antes da verificação de relações do conjunto. Regressão: 138 testes aprovados.

Evidências, consultas de conferência, definições anteriores e PDFs com acesso restrito: `/opt/backups/orbita/sigs-validation-20261025/`. Não imprimir conteúdo de pacientes nos logs.
