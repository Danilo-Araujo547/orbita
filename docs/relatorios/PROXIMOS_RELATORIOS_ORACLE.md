# Próximos relatórios Firebird → Oracle

Mapeamento de 25/10/2026. Fontes: catálogo e BLR recuperados do WhatsReport em 24/10; acesso Oracle prdvotu em 25/10. Nenhuma procedure de negócio ou sincronizador foi executado. Esta etapa mapeia; não declara os quatro documentos finais integrados ou reconciliados.

Planilha principal: https://docs.google.com/spreadsheets/d/13aQJVPIKGuBpi94uvPoQiA0SQo_14NrMDZijqec_YLM/edit — aba Acompanhamento. Chave: unidade + código. Sempre atualizar essa planilha a cada mapeamento, validação ou integração; o markdown local não substitui a planilha compartilhada.

## Ordem proposta

1. **53 — Exames por atendimento – Completo**. GLDADOS.FDB → componentes 42/52 → PROC_EXAMES_POR_ATENDIMENTO. Fontes Oracle recuperadas e executadas: carga 33, ATENDIMENTOS; carga 35, EXAMES. Regras por prestador e meta DEFGER2.META_EXAMES_ATENDIMENTO ainda precisam de reconciliação. CADASTRO_PRESTADORES seleciona/ordena prestadores; preservar os critérios sem deduplicar por nome automaticamente. Destino: consultas Oracle + configuração local explícita + Canvas, sem cache Firebird.
2. **39 — Altas até as 10 horas – Meta**, acompanhado de componentes 38 (tipo 1) e 41 (tipo 3). GLDADOS → PROC_ALTAS_ATE_AS_10 tipo 2, ID 38, SERIES1. Carga 30 INTERNACAO_USUARIO vem de ATENDIME e cadastros/junções hospitalares do Oracle. No BLR há H_ALTA_MEDICA, DATA_ALTA_MEDICA, limite 10:00 e CADASTRO_ESPECIALIDADES (ATIVO_ALTAS/ORDEM_APRESENTACAO_ALTAS). Parâmetros internos não devem aparecer como perguntas de usuário. Não inferir a meta nem o denominador do tipo 2 pela simples contagem das altas. Destino: Oracle + cadastro local de regras necessário + Canvas.
3. **75 — FPO MAC Decêndio Financeiro** e **81 — FPO MAC Decêndio Físico**. GLDADOS → PROC_FPO. Fontes 69 FPO_AMBULATORIAL, 70 FPO_AIH, 72 FPO_PROCEDIMENTO_SUS e 74 FPO_COMPLEXIDADE_AMB têm SQL Oracle recuperado; conferência de acesso/colunas em produção aprovada. O BLR de PROC_FPO contém SQL dinâmico contra FPO_COTA_DRS_PROCEDIMENTOS, FPO_AMBULATORIAL, FPO_AIH e FPO_DEPARA_MUTIRAO; também chama PROC_FPO_CALCULA_PERCENTUAL, PROC_FPO_SET_NULL e PROC_FPO_RETORNA_IMAGEM. As dependências de SQL dinâmico não aparecem necessariamente no RDB$DEPENDENCIES: as strings do BLR foram preservadas, mas não equivalem à fonte integral. A consulta ALL_TABLES não encontrou os dois auxiliares FPO com esses nomes visíveis ao usuário Oracle; isso não prova ausência de equivalentes com outros nomes.

## FPO: o que falta preservar

- Competência MM/AAAA; filtros MAC e FINANCEIRO/FISICO, DECENDIO=S, grupos e tratamento de itens sem contrato. Substituir critérios textuais legados por filtros fechados, nunca oferecer SQL arbitrário como parâmetro.
- Cotas, grupos e classificação de procedimentos em FPO_COTA_DRS_PROCEDIMENTOS; remessas CORUJAO/MUTIRAO e MUTIRAO SEM CONTRATO no DEPARA. Campos/origem de preenchimento/vigência e conteúdo ainda pendentes.
- A carga 80 é uma derivação Firebird: lê FPO_AIH, SINCRONISMO_AUTOMATICO=S, força VL_TOTAL_CONTA=1 e TIPO_FISICO_FINANCEIRO=FISICO. Não deve ser tratada como saldo monetário nem consulta Oracle independente. Complementos COMPLEXIDADE/AGRUPAMENTO/FINANCIAMENTO/DECENDIO precisam de origem documentada.
- Cores não exigem imagens externas: fonte textual de PROC_RETORNA_IMAGEM_FPO indica <95 vermelho, 95–100 verde, >100 preto para percentual positivo; esse objeto é distinto de PROC_FPO_RETORNA_IMAGEM, chamado por PROC_FPO. Não equiparar as duas rotinas sem comparação.
- Antes de migrar: reconciliar competência real por grupo/decêndio, projeção e cotas, e montar documento Canvas. Não precisa manter Firebird para as cargas hospitalares, mas eliminar os cadastros auxiliares sem portá-los mudaria o relatório.

## Conferências Oracle

SELECTs em transação somente leitura; não criados views, tabelas ou snapshots na origem.

| Fonte | Conferência | Resultado |
|---|---|---|
| 30 | Query original compilada; filtro por datas adaptado e executado | 1.026 linhas de altas; 485 com H_Alta_Medica <= 10:00, 01–24/10/2026 |
| 33 | Query original compilada; período delimitado | 428 linhas por data/prestador; soma 1.744 atendimentos |
| 35 | Query original compilada; ambos os ramos delimitados | 555 linhas por data/prestador; soma 3.748 exames |
| 69 | SELECT original com WHERE 1=0 | 24 colunas; sem validação dos valores |
| 70 | SELECT original com WHERE 1=0 | 18 colunas; sem validação dos valores |
| 72 | SELECT original com WHERE 1=0 | 18 colunas; sem validação dos valores |
| 74 | SELECT original com WHERE 1=0 | 3 colunas; sem validação dos valores |

As duas bases de atendimentos/exames mantêm os filtros originais (urgência, convênio 2 e exclusão da origem 46 onde existente); não representam toda a produção hospitalar. O probe simples de ATENDIME para altas também retornou 1.026/485, coerente com a fonte recuperada neste recorte. Não é reconciliação com o resultado da procedure ou o PDF legado.

## Próxima família, ainda fora da fila Oracle confirmada

ACS/eSUS (175 e variantes por UBS) ainda chega ao Firebird local por PRODUCAO_AGENTE_15_DIAS / 35_DIAS e PRODUCAO_AGENTE_ESUS em outras bases legadas. Não há cadeia Oracle comprovada para marcá-los como candidatos diretos nesta etapa. Permanecem pendentes, sem reaproveitar a credencial SIGS para uma origem presumida.

## Evidências e estado

Arquivos originais, queries delimitadas, hash, colunas, BLR strings e resultados agregados: `/opt/backups/orbita/report-next-mapping-20261025/`. Não há dados de pacientes nas evidências agregadas. Quatro relatórios finais e doze componentes/fontes tiveram o mapeamento atualizado; nenhum foi habilitado e nenhum layout fictício foi criado. Futuras implementações serão pelo Canvas.

A planilha também recebeu os avanços já concluídos dos cinco relatórios SIGS (Canvas, desativados) e Leitos (coleta prdvotu em produção, histórico preservado).


## Atualização de implementação — 26/10/2026

Exames por atendimento (53) integrado ao Oracle/Canvas. Meta 2,50 confirmada em DEFGER2; CADASTRO_PRESTADORES é tabela auxiliar reconstruída pela procedure, não cadastro manual fixo neste fluxo. Ver EXAMES_POR_ATENDIMENTO_ORACLE.md.
