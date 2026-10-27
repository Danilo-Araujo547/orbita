# Origem dos quatro relatórios pendentes

Investigação em 23/10/2026, somente de leitura. Nenhum BAT, macro, sincronização, procedure de negócio ou envio foi executado. Nenhum arquivo foi gravado nos servidores legados. Evidências foram lidas do catálogo recuperado em 22/10, dos arquivos fornecidos e dos metadados Firebird já preservados; acesso SMB de leitura ao servidor 172.16.0.123 também foi validado novamente.

## Resultado

| Relatório recebido | Cadastro real no WhatsReport | Gerador identificado |
|---|---|---|
| Indicadores vidas Sansaúde | 310 · INDICADORES - VIDAS SANSAUDE | Composição dos relatórios 271 e 308; PROC_ALTAS_ATE_AS_10, tipos 8 e 9, no GLDADOS.FDB |
| Exportar tabela leitos | 311 · EXPORTAR TABELA LEITOS | SELECT na tabela Firebird LEITOS_SISTEMA com data inicial/final |
| Indicadores médicos | 40 · INDICADORES MEDICOS | Composição de sete relatórios locais; PROC_ALTAS_ATE_AS_10 e PROC_EXAMES_POR_ATENDIMENTO |
| Indicadores informativos | 20 · COMPLETO TAXA OCUPAÇÃO | Composição de dez relatórios locais; PROC_RESUMO_ATENDIMENTOS e PROC_ALTAS_ATE_AS_10 |

O nome exibido no cadastro nem sempre é o nome do PDF. Informativos está sob COMPLETO TAXA OCUPAÇÃO, mas DESCRICAO e NOME_PDF identificam INDICADORES_INFORMATIVOS. Há variantes de demonstração, IDs 55 e 56; não são os arquivos principais examinados.

A base Firebird usada na geração é a base legada 3: 172.16.0.123:3050, C:\WhatsReport\Servidor\BD\GLDADOS.FDB. As consultas de sincronização hospitalar usam a base legada 1, Oracle 172.16.0.254:1521, serviço prdvotu. Não confundir GLDADOS.FDB com BASE.FDB, que guarda o catálogo e as permissões da aplicação.

## 1. Vidas Sansaúde

O PDF fornecido tem duas páginas: Vidas Sansaúde e Vidas Sansaúde - Metas. Essa sequência corresponde ao cadastro composto 310:

1. 271 · VIDAS SANSAUDE → PROC_ALTAS_ATE_AS_10(8, 62, 'SERIES1').
2. 308 · VIDAS SANSAUDE - METAS → PROC_ALTAS_ATE_AS_10(9, 62, 'SERIES1').

Os metadados e a estrutura BLR dessa procedure identificam as tabelas SAN_VIDAS, SAN_VIDAS_MES e SAN_VIDAS_METAS. O ramo do tipo 9 tem junção entre SAN_VIDAS_MES e SAN_VIDAS_METAS por mês/ano. O tipo 8 também referencia o histórico mensal. A assinatura foi confirmada pelos parâmetros de entrada: WPA_TIPO_RELATORIO, WPA_ID_RELATORIO, WPA_SERIES.

A entrada hospitalar identificada é o cadastro 268, SAN_VIDAS_TEMP, descrição “25 - SINCRONIZAR TABELA NUMERO_VIDAS”, incluído no sincronizador 59. Sua consulta Oracle, recuperada integralmente, usa DBAPS.USUARIO, CONTRATO, DESLIGAMENTO, GRAU_PARENTESCO, PLANO e TIP_ACOMODACAO. Produz totais por TP_CONTRATO, SN_ATIVO e DATA_FILTRO, com regras de cadastro, desligamento/reativação, planos e exclusões específicas.

**Limite do rastreamento:** a transformação entre SAN_VIDAS_TEMP e as tabelas finais SAN_VIDAS/SAN_VIDAS_MES ainda não foi comprovada, nem quem cadastra/atualiza SAN_VIDAS_METAS. Não tratar esse trecho como SQL recuperado ou como carga automática já confirmada.

**Cadastro diferente:** o relatório 269, INDICADORES VIDAS SANSAUDE, aponta para o arquivo externo C:\Controladoria\Sansaude\VIDAS_SANSAUDE.pdf, ausente na inspeção anterior. Ele tem nome parecido e até saída com nome semelhante, mas não explica o PDF de duas páginas fornecido. O composto 310 explica essa estrutura.

## 2. Exportar tabela leitos

Consulta efetiva do relatório 311, base Firebird 3:

```sql
select *
from leitos_sistema
where data between WPA_DATA_INICIAL and WPA_DATA_FINAL
```

A tabela é alimentada pelo sincronizador 17, “02 - SINCRONIZAR LEITOS_SISTEMA”, base Oracle 1. Consulta de origem recuperada:

```sql
select unid_int.cd_unid_int,
       unid_int.ds_unid_int,
       count(*) as quantidade,
       sysdate as data
from leito
join unid_int on unid_int.cd_unid_int = leito.cd_unid_int
where tp_situacao = 'A'
  and sn_extra = 'N'
  and tp_ocupacao in ('O', 'V', 'R', 'L')
  and unid_int.cd_unid_int not in (11, 12, 17)
group by unid_int.cd_unid_int, unid_int.ds_unid_int
order by unid_int.ds_unid_int
```

LEITO e UNID_INT estão sem qualificação de schema nesse SQL: resolver proprietário/sinônimos ao reconstruir no Oracle.

O arquivo fornecido possui uma aba Tabela, 461 linhas de dados e cabeçalhos CD_UNID_INT, DS_UNID_INT, QUANTIDADE e DATA, compatíveis com a consulta. Não possui connections.xml nem vínculos externos no pacote XLSX examinado. O XML registra C:\Users\iguisi\Desktop\ROB8\ como caminho de salvamento e última modificação por Isabela - Controladoria SCV; isso indica manuseio do exportado, não uma conexão própria com Oracle.

No grupo 61, a ordem é 22 (limpeza), 17 (leitos), 23 (gerar LEITOS_DISPONIVEIS), 16 (pacientes-dia). PROC_LIMPAR_PACIENTES_DIA possui fonte textual e remove a carga de LEITOS_SISTEMA do dia atual antes da reposição; não executada nesta investigação. A consulta de exportação lê o cache histórico dentro do período solicitado, não apenas o estado atual dos leitos.

PROXIMA_ETAPA tem valor 80 no cadastro 311. Esse valor foi preservado, mas sua semântica na aplicação não foi comprovada; não executá-lo nem inferir automaticamente uma dependência de dados a partir dele.

## 3. Indicadores médicos

O PDF de sete páginas coincide com a ordem do composto 40:

| Ordem | Cadastro | Conteúdo | Rotina |
|---|---|---|---|
| 1 | 45 | Cabeçalho | Consulta CADCLI e layout do relatório |
| 2 | 54 | Permanência hospitalar geral | PROC_ALTAS_ATE_AS_10, tipo 4 |
| 3 | 63 | Permanência por especialidade SUS | PROC_ALTAS_ATE_AS_10, tipo 5 |
| 4 | 42 | Exames por atendimento, geral | PROC_EXAMES_POR_ATENDIMENTO, tipo 1 |
| 5 | 51 | Exames por atendimento, tabela | PROC_EXAMES_POR_ATENDIMENTO, tipo 4 |
| 6 | 68 | Tempo de parecer médico por especialidade | PROC_ALTAS_ATE_AS_10, tipo 22 |
| 7 | 46 | Rodapé | Consulta CADCLI e layout do relatório |

Fontes Oracle/caches identificadas no sincronizador 59:

- 30 → INTERNACAO_USUARIO: DBAMV.ATENDIME, MOV_INT, LEITO, UNID_INT, MOT_ALT, ESPECIALID e cadastros relacionados.
- 33 → ATENDIMENTOS: DBAMV.ATENDIME e cadastros de convênio, origem, prestador e especialidade.
- 35 → EXAMES: DBAMV.PED_RX/ITPED_RX/EXA_RX e PED_LAB/ITPED_LAB/EXA_LAB, ligados a ATENDIME e cadastros.
- 66 → PARECER: DBAMV.PAR_MED, PRESTADOR e ESPECIALID.
- 67 → PARECER_ATENDIMENTOS: DBAMV.ATENDIME e cadastros relacionados.

As dependências Firebird confirmam INTERNACAO_USUARIO, MOTIVO_ALTA, PARECER/PARECER_ATENDIMENTOS em PROC_ALTAS_ATE_AS_10; e ATENDIMENTOS, EXAMES, CADASTRO_PRESTADORES em PROC_EXAMES_POR_ATENDIMENTO. CADCLI nos cabeçalhos/rodapés não é a fonte dos indicadores clínico-operacionais; a leitura dessa tabela não substitui as procedures de cálculo.

## 4. Indicadores informativos

O PDF de dez páginas coincide com o composto 20:

1. 43 · Cabeçalho.
2. 19 · Paciente-dia e ocupação geral: PROC_RESUMO_ATENDIMENTOS, tipo 1, convênio TODOS.
3. 24 · Paciente-dia e ocupação SUS: mesma procedure, tipo 1, convênio SUS.
4. 25 · Paciente-dia e ocupação convênio: mesma procedure, tipo 1, convênio CONVENIO.
5. 18 · Ocupação por setor: PROC_RESUMO_ATENDIMENTOS, tipo 2, convênio TODOS.
6. 62 · Média de atendimentos: PROC_ALTAS_ATE_AS_10, tipo 7.
7. 64 · Média de cirurgias eletivas: PROC_ALTAS_ATE_AS_10, tipo 20.
8. 65 · Média de cirurgias urgência/emergência: PROC_ALTAS_ATE_AS_10, tipo 21.
9. 58 · Média total de cirurgias: PROC_ALTAS_ATE_AS_10, tipo 6.
10. 44 · Rodapé.

PROC_RESUMO_ATENDIMENTOS depende de PACIENTES_DIA, LEITOS_DISPONIVEIS e CADASTRO_SETORES, além de estruturas de gráfico. O sincronizador 16, da base Oracle 1, calcula os dados de pacientes-dia usando DBAMV.MOV_INT, ATENDIME, LEITO, UNID_INT, CONVENIO, MOT_ALT e TIP_RES. O sincronizador 17 fornece a capacidade de leitos, seguido pela rotina 23 para LEITOS_DISPONIVEIS.

No grupo 59, a rotina 60 carrega ATENDIMENTOS_PS e a 57 carrega CIRURGIAS. A origem da cirurgia é DBAMV.AVISO_CIRURGIA/CIRURGIA_AVISO/CIRURGIA, vinculada a ATENDIME e aos demais cadastros. Esses caches sustentam os blocos de média de atendimento e cirurgia.

## Programações encontradas na fotografia do legado

São horários cadastrados, não prova de execução bem-sucedida atual. O fuso efetivo do Windows/agendador não foi auditado nesta etapa; os valores abaixo são os campos TIME_START do cadastro, sem conversão.

- Sincronizador 59: 04:00:12, todos os dias.
- Sincronizador 61: 04:20:23, todos os dias.
- Informativos 20: 07:20:00 e 07:23:00, todos os dias, em programações distintas.
- Médicos 40: 07:26:00 e 07:37:10, todos os dias, em programações distintas.
- Vidas composto 310: 12:20:45 e 12:21:02, segunda a sexta, em programações distintas.
- Não apareceu programação do 311 na fotografia consultada; isso não prova ausência de outras formas de chamada.

As programações do SCV Messenger não foram ativadas nem alteradas.

## Estrutura compilada recuperada

Os fontes RDB$PROCEDURE_SOURCE de PROC_RESUMO_ATENDIMENTOS, PROC_ALTAS_ATE_AS_10 e PROC_EXAMES_POR_ATENDIMENTO estão vazios no material já coletado. Foi possível recuperar sua estrutura compilada BLR em processamento offline, usando a biblioteca cliente Firebird em container isolado sem rede. Isso revela tabelas, campos, ramos e operações; não é o texto PSQL original recuperado.

Arquivos privados de evidência: /opt/backups/orbita/reports-catalog-20261022/origens-pendentes-20261023/. Contêm as três listagens BLR, versões anotadas e SQLs de origem selecionados. Nenhum desses arquivos contém credencial de acesso.

## Pendências para equivalência fiel no SCV Messenger

- Fechar a carga SAN_VIDAS_TEMP → tabelas finais e a alimentação das metas.
- Transcrever e validar todas as fórmulas, arredondamentos, cortes de período e exceções das procedures compiladas. Apenas conhecer as dependências não prova equivalência dos cálculos.
- Confirmar schemas/sinônimos dos objetos sem proprietário nos SQLs.
- Recuperar layouts/gráficos e validar os resultados em amostras controladas antes de ativar os relatórios novos.
- Confirmar a atualização atual dos caches e a execução atual das programações por logs, separadamente do cadastro.

Não é necessário localizar uma planilha-fonte de geração dos PDFs internos para identificar estes geradores; as planilhas usadas pelos três relatórios externos já encontrados constituem outro fluxo.


## Validação posterior em 23/10/2026

A carga SAN_VIDAS_TEMP → SAN_VIDAS/SAN_VIDAS_MES foi confirmada pelo trigger ativo SAN_VIDAS_TEMP_BIU0. Os valores das metas também foram recuperados e conferidos com o PDF. Foram encontradas falha no fechamento de mês do trigger, ausência de capacidade de leitos tratada como ocupação zero e dependência de cadastro manual G4 para capacidade SUS/convênio. A autoria/manutenção das metas ainda não foi identificada.

Ver [validação numérica e limites](VALIDACAO_CALCULOS_RELATORIOS.md). Esta atualização supera as pendências específicas da carga de vidas descritas anteriormente, sem afirmar que todas as fórmulas estejam reconstruídas.
