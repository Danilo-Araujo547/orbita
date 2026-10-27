# Validação dos cálculos dos relatórios legados

Data: 23/10/2026. Banco consultado: GLDADOS.FDB em 172.16.0.123:3050. Evidências privadas: /opt/backups/orbita/reports-catalog-20261022/validacao-calculos-20261023/.

## Escopo e método

Conexões Firebird em transação snapshot somente leitura, com coleta automática de lixo desabilitada para a conexão e triggers de conexão desabilitados. Foram executados SELECTs de metadados e agregados. Nenhuma procedure de negócio, macro, BAT, sincronização ou envio foi executado; nenhum arquivo foi escrito nos servidores legados. Os dados coletados foram limitados a contagens, somas, datas, especialidades, setores e metadados, sem nomes ou identificadores de pacientes.

Os PDFs fornecidos têm datas diferentes da leitura atual: Médicos/Informativos de 15/10/2026 e Vidas de 21/10/2026. Comparar com cache atual não reconstrói automaticamente o snapshot antigo. A validação distingue correspondência comprovada, divergência e hipótese de causa.

## Resultado numérico

| Verificação | Resultado |
|---|---|
| Exportação de leitos: 01/09 a 05/10/2026 | 461/461 linhas iguais em código, setor, quantidade e data, incluindo multiplicidade |
| Atendimentos: meses de out/2025 a out/2026, último mês até 14/10 | 13/13 totais iguais ao PDF |
| Atendimentos: dias 07 a 14/10 | 8/8 totais iguais |
| Exames: meses de out/2025 a out/2026, último mês até 14/10 | 12/13 iguais; outubro tem 2.125 no cache atual contra 2.103 no PDF |
| Exames: dias 07 a 14/10 | 3/8 iguais; cinco dias divergentes, detalhados abaixo |
| Permanência SUS: Clínica Geral e Ortopedia, out/2025 a out/2026 até 14/10 | 26/26 médias iguais, com duas casas decimais |
| Ocupação: cinco setores, oito dias | 40/40 percentuais reproduzidos, incluindo os zeros indevidos quando falta capacidade |
| Vidas: totais diários 11 a 20/10 | 9/10 iguais; 20/10 tem 18.567 no cache atual e 18.565 no PDF |
| Vidas: totais mensais out/2025 a out/2026 | 12/13 iguais; outubro atual tem 18.539, PDF de 21/10 mostra 18.565 |
| Metas de vidas: out/2025 a out/2026 | 13/13 valores iguais ao PDF |

O agregado anual de 2025 de exames (36.071) e atendimentos (25.305) também confere com o PDF. O mês de outubro foi cortado em 15/10 exclusivo para comparação com o PDF emitido naquele dia. Para as metas, foram comparados valores de SAN_VIDAS_METAS, não inferidos de uma planilha externa.

## Fórmulas verificadas

### Ocupação

O BLR de PROC_RESUMO_ATENDIMENTOS usa somas de CVU_PAC_DIA em PACIENTES_DIA e de QUANTIDADE em LEITOS_DISPONIVEIS. Calcula médias diárias do período, arredonda cada média para inteiro e depois arredonda a razão percentual. É necessário preservar a ordem das operações para equivalência, pois razão de totais sem arredondamentos intermediários pode divergir.

Na amostra diária, a razão 100 × pacientes / leitos, arredondada ao inteiro, reproduz os valores do PDF. Exemplos:

- ALA B, 07/10: 33 / 38 × 100 → 87%.
- ALA C, 14/10: 12 / 15 × 100 → 80%.
- UCO SEMI, 09/10: 4 / 3 × 100 → 133%.

Os 40 pontos incluem ALA B, ALA C, ALA I - Clínica Médica, UTI Geral e UCO SEMI, nos dias 07 a 14/10. Não representam validação de todos os setores nem de todas as janelas mensais.

### Permanência

No ramo correspondente, PROC_ALTAS_ATE_AS_10 soma DIAS_INTERNADO e divide pela quantidade de registros em INTERNACAO_USUARIO, com filtro de DATA_ALTA_MEDICA e de convênio/especialidade, arredondando para duas casas. A reconstrução por agregados de Clínica Geral/SUS e Ortopedia/SUS reproduziu as 26 médias mensais examinadas. Não foi feita ainda validação de todas as especialidades, pareceres e cirurgias.

### Exames por atendimento

O ramo tipo 4 de PROC_EXAMES_POR_ATENDIMENTO soma QUANTIDADE nas tabelas EXAMES e ATENDIMENTOS por período para as duas linhas da tabela. O BLR confirma os nomes e o uso de SUM, com filtros de DATA. A tabela e as quantidades históricas fechadas conferem; os valores de outubro apresentados no PDF antigo não são todos iguais aos encontrados agora.

Diferenças diárias, PDF → cache atual:

- 08/10: 175 → 178.
- 10/10: 122 → 124.
- 12/10: 87 → 89.
- 13/10: 271 → 281.
- 14/10: 147 → 150.

Os outros três dias conferem. Atualização posterior é uma explicação possível, mas não foi comprovada por log/auditoria do snapshot do dia 15. Não classificar automaticamente as divergências como erro de fórmula ou correção legítima.

## Falha confirmada: falta de capacidade vira ocupação 0%

Em 10/10/2026, há pacientes em PACIENTES_DIA mas faltam quantidades correspondentes em LEITOS_DISPONIVEIS nos cinco setores examinados. O PDF mostra 0%. Exemplos: ALA B tem 34 pacientes; ALA I tem 22; UTI Geral tem 13. Zero de ocupação não representa essa situação: o denominador está ausente.

PROC_RESUMO_ATENDIMENTOS protege a divisão e deixa o resultado zero quando a capacidade não é positiva. Isso é compatível com o comportamento do PDF, mas mascara falha de carga. No SCV, recomendar estado “capacidade não carregada”, sem apresentar taxa válida, e impedir que essa ausência passe despercebida. Nenhuma correção foi aplicada ao legado.

## Dependência manual confirmada: capacidade SUS/convênio

A fonte textual de PROC_LEITOS_DISPONIVEIS foi recuperada ao vivo. Ela documenta explicitamente que CADASTRO_LEITOS é alimentada manualmente no cadastro de leitos do G4. A rotina:

1. Lê a quantidade real de LEITOS_SISTEMA para a data exata de referência.
2. Soma a capacidade cadastrada em CADASTRO_LEITOS, inclusive SUS e CONVENIO.
3. Calcula proporção SUS = capacidade SUS / capacidade total cadastrada; inicia com 1 se não houver total positivo.
4. Calcula leitos SUS = TRUNC(leitos do sistema × proporção SUS).
5. Define leitos convênio como o restante.
6. Faz UPDATE OR INSERT em LEITOS_DISPONIVEIS por setor, convênio e data.

Portanto, reconstruir só a consulta Oracle não reproduz a separação SUS/convênio sem esse cadastro manual e suas regras. Também é importante preservar a data usada: o filtro da rotina é igualdade de timestamp, não comparação por dia truncado.

## Carga de vidas confirmada

O trigger ativo SAN_VIDAS_TEMP_BIU0, na tabela SAN_VIDAS_TEMP, possui fonte textual. O fluxo antes pendente está confirmado:

Oracle/consulta 268 → SAN_VIDAS_TEMP → trigger → SAN_VIDAS e SAN_VIDAS_MES → procedure tipo 8/9 → relatório composto 310.

- Se contrato, situação e data estiverem preenchidos, faz UPDATE OR INSERT em SAN_VIDAS com chave TP_CONTRATO, SN_ATIVO e DATA_FILTRO.
- Para o fechamento mensal, faz UPDATE OR INSERT em SAN_VIDAS_MES com chave TP_CONTRATO, MES_FILTRO, SN_ATIVO e ANO, usando a linha que satisfaz o critério de ontem.
- As somas do relatório não filtram apenas SN_ATIVO='S' nos ramos examinados; incluem os grupos de situação preservados no cache. Filtrar somente ativos alteraria o resultado observado.

### Falha confirmada na virada de mês/ano

A condição mensal exige simultaneamente:

```
dia(DATA_FILTRO) = dia(agora - 1)
mês(DATA_FILTRO) = mês(agora)
ano(DATA_FILTRO) = ano(agora)
```

No primeiro dia do mês, a data correta de ontem pertence ao mês anterior e falha na segunda condição; em janeiro, também falha no ano. Isso impede o fechamento mensal do último dia do mês pelo trigger nessa passagem. Testes puros de datas reproduziram a falha para 01/11/2026, 01/01/2027 e 01/03/2028. A correção conceitual é comparar a data completa ao dia anterior, e não partes do dia anterior combinadas com mês/ano atuais. Não executada nem aplicada ao legado.

SAN_VIDAS_MES representa um snapshot que é substituído durante o mês, não uma soma de pessoas únicas ao longo do mês. Assim, diferenças no mês corrente entre um PDF de 21/10 e a leitura de 23/10 não são comparação entre snapshots equivalentes.

### Metas: valores recuperados, autoria ainda pendente

SAN_VIDAS_METAS contém MES, ANO e META; foram recuperadas 24 linhas de 2025/2026 e as 13 metas do PDF conferem. A procedure tipo 9 usa essa tabela na composição. Não foi identificada nesta etapa a tela, usuário ou rotina externa que mantém essas metas; a leitura dos valores não comprova o método de manutenção.

## Código compilado e efeitos colaterais

As três procedures principais lidas em 23/10 possuem o mesmo SHA-256 do BLR coletado em 22/10, portanto a análise anterior corresponde à revisão atual examinada. Os fontes PSQL continuam ausentes. A listagem BLR de PROC_EXAMES_POR_ATENDIMENTO contém operações de escrita em tabelas auxiliares, como CADASTRO_PRESTADORES. Por isso não foi chamada para “testar o retorno”; foram usados apenas SELECTs independentes das tabelas e inspeção offline do código.

## Limites da conclusão

- Validado: encadeamento, trigger de vidas, dados amostrados, regras recuperadas e falhas descritas acima.
- Ainda não validado integralmente: todos os ramos, períodos, especialidades, pareceres e gráficos; interpretação completa do BLR e equivalência de uma implementação nova.
- Não executadas consultas pesadas no Oracle hospitalar para refazer toda a carga. A comparação numérica foi contra os caches usados pelo próprio gerador legado.
- Sem snapshot do Firebird de 15/10 e 21/10 ou auditoria de alterações, as divergências históricas não podem ser resolvidas como erro versus atualização posterior com certeza.
- Legado e programações do SCV não foram alterados; nenhuma mensagem foi enviada nesta validação.
