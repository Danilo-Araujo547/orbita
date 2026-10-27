# Snapshots diários de leitos

Implementação de 24/10/2026. Coleta independente dos envios e das programações de relatórios.

## Operação

Em Relatórios → Coletas, configurar a consulta Oracle, ambiente, horário local da unidade, dias da semana, tolerância e ativação. Formulários abrem por Adicionar/Editar. Coletar agora captura somente a posição corrente do dia; repetir após sucesso retorna a mesma snapshot. Histórico mostra horário programado, horário efetivo, ambiente, quantidade de linhas, situação e os registros por unidade de internação.

A rotina consulta o Oracle em transação somente de leitura, usando a conexão criptografada existente. Não consulta nem grava no Firebird e não chama transporte WhatsApp. O componente SQL é editado na aba Componentes. O intervalo entre ticks é de 30 segundos: 04:20:23 é o limite inicial, sem execução antecipada, e a coleta inicia no próximo tick disponível.

## Cadastro inicial SCV

- Origem: Oracle Santa Casa de homologação, conexão 19, hmlvotu; não é produção hospitalar.
- Componente: `bed-position-oracle`, consulta em `backend/operations/report_sql/bed_position.sql`.
- Coleta: `bed-position-daily`, diariamente às 04:20:23 no fuso da unidade, com tolerância de 60 minutos.
- Exportação: `legacy123-311`, EXPORTAR TABELA LEITOS, formato XLSX.
- Permissão manual do destinatário Danilo -- STI. Nenhuma programação de envio é ativada.
- Primeira captura realizada manualmente em 24/10/2026. O horário efetivo dessa captura é preservado; não representa uma captura retrospectiva às 04:20.

## Persistência e garantias

`ReportSnapshotConfiguration` mantém unidade, componente de origem, relatório de saída, ambiente, calendário e versão.

`ReportSnapshotRun` mantém data de referência, programação, início e fim, horário de coleta, horário Oracle, estado, tentativas, solicitante e fotografia da consulta/conexão sem credenciais.

`BedSnapshotRow` guarda código da unidade de internação, descrição, quantidade e horário Oracle integral. O run determina a data lógica da posição diária.

A restrição única por configuração, identidade da origem e data, combinada com bloqueios de linha e token por tentativa, impede coletas duplicadas e gravação de workers antigos. Linhas só são inseridas quando a coleta completa foi validada; resultados vazios, colunas divergentes, códigos repetidos, quantidades negativas ou fracionárias e datas incompatíveis falham sem gravação parcial. Snapshots concluídas não são sobrescritas.

Mudanças em SQL, conexão física, ambiente ou fuso geram outra identidade de dados; homologação e produção não se misturam. Mudanças de calendário não reescrevem o histórico. Fonte/credencial/configuração e permissões são verificadas novamente antes da gravação.

O scheduler tenta até três vezes dentro da janela, com intervalo de cinco minutos. Trabalho interrompido pode ser retomado após cinco minutos, com token novo. Depois da janela, marca a coleta perdida. Não se simula uma captura histórica usando os valores atuais.

## XLSX e período

Parâmetros `WPA_DATA_INICIAL` e `WPA_DATA_FINAL`, inclusivos, até 366 dias sem datas futuras. A exportação lê apenas snapshots concluídas da unidade e origem do relatório. Na coleta Oracle atual, dias previstos no calendário sem snapshot bloqueiam a exportação. No histórico legado importado, o arquivo contém somente os registros reais disponíveis, com lacunas informadas na execução. Nenhuma origem preenche ausências com zero ou dados atuais.

Mesmas quatro colunas, na mesma ordem: CD_UNID_INT, DS_UNID_INT, QUANTIDADE, DATA. Códigos e quantidades são números; DATA é uma data Excel no formato dd/mm/yyyy, à meia-noite, como no legado. Horários reais ficam no histórico da coleta, não como colunas extras da planilha. Descrições são strings literais e não fórmulas.

O arquivo é gerado no pipeline de execução existente, com autorização revalidada para solicitação, geração e download/entrega. Baileys reconhece o MIME e o conteúdo binário XLSX, mas a coleta não dispara mensagens.

O histórico real do ROB8 de 24/09 a 23/10/2026 foi importado posteriormente: 28 dias com 390 registros e duas datas sem dados (04/10 e 10/10). Ele permanece separado da coleta HML, com origem de produção identificada. Consultar `IMPORTACAO_HISTORICO_LEITOS.md` para procedência, SQL PostgreSQL e regras de cobertura.

## APIs

Todas usam `/api/v1/`, unidade e permissão administrativa na seção Relatórios:

- `report-snapshots/`: listagem e cadastro; `/{id}/configure/` exige versão e Idempotency-Key.
- `report-snapshots/options/`: consultas Oracle e relatórios compatíveis da unidade.
- `report-snapshots/{id}/collect/`: POST com versão e Idempotency-Key; captura somente hoje.
- `report-snapshot-runs/`: histórico paginado; filtros configuration e state.
- `report-snapshot-runs/{id}/records/`: registros paginados de uma captura.

A exportação continua em `report-executions/` e no pedido autorizado pelo WhatsApp. Não há API para editar ou excluir snapshots.

## Implantação e validação

Migration `operations.0024_bed_snapshots_and_xlsx`. Registrar uma vez usando `configure_bed_snapshots --unit scv --connection 19 --environment homologation --enable-collection --recipient 112`; manutenção posterior pelo painel.

17 testes de regressão específicos em `backend/tests/test_bed_snapshots.py`, incluindo concorrência real em PostgreSQL, calendário, falhas, isolamento, autorização, idempotência, origem alterada, campos e tipos XLSX e ausência de transporte. Regressão com catálogo, WhatsApp, PDF médico, arquivos externos e permissões: 138 testes aprovados. TypeScript/Vite compilados; OpenAPI validado, sem erros (um aviso preexistente sobre ConfigurationInput).

Backup anterior, logs de testes e builds: `/opt/backups/orbita/bed-snapshots-20261024/`.

### Validação publicada

Configuração 1; componente 354; primeira snapshot 6e82811b-7682-4898-955d-f018293a459e, manual às 11:33:26 de Brasília em 24/10/2026, com 15 unidades e 219 leitos HML. Exportação 08aa45b1-a3d1-4617-9ad7-7d2dd9492ea3: 15 linhas, quatro colunas, download HTTP 200, 5.464 bytes, delivery_state=not_requested.


### Apresentação da planilha

A exportação mantém uma única aba e as quatro colunas originais, sem linhas adicionais. Blocos de datas alternam branco e azul suave; uma borda superior marca cada nova data. Cabeçalho fixo, filtro, larguras e impressão ajustados. Valores, tipos e seleção do histórico permanecem iguais.


### Acesso pela interface — 25/10/2026

A configuração fica em Relatórios → Componentes → Coleta. A categoria reúne edição da programação, coleta manual e histórico. Editar query abre a consulta SQL cadastrada no componente de origem; salvar usa a API de componentes, com validação de SELECT, unidade, auditoria e versão concorrente. Alterar SQL muda a identidade da fonte para novas coletas; snapshots existentes permanecem preservados. A antiga rota reportTab=snapshots continua compatível; a rota atual é reportTab=components&componentCategory=collection.


## Coletas e históricos — 25/10/2026

A categoria Coleta passou a atender três conjuntos tipados: leitos totais, capacidade SUS/convênio e Vidas. O armazenamento original de leitos e seus hashes foram preservados; os demais usam ReportSnapshotDataRow. Ver VALIDACAO_CADASTRO_SNAPSHOTS.md.
