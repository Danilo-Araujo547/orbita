# Completo Taxa Ocupação: integração Oracle em andamento

Data: 24/10/2026. Unidade SCV; `legacy123-20`, ID 33. O usuário escolheu gerar o PDF a partir dos dados Oracle. Não converter para PDF externo por pasta.

## Fontes e decisões

Preservar as dez páginas/partes documentadas: capa 43; ocupação geral 19, SUS 24 e convênio 25; setores 18; atendimentos 62; cirurgias eletivas 64, urgência/emergência 65 e total 58; encerramento 44.

O usuário autorizou recuperar o cadastro/histórico de capacidade do legado em leitura, para futura validação de produção. Não misturar essa capacidade com dados da conexão Oracle 19 (homologação). Oracle LEITO atual e suas datas de ativação/desativação não comprovam toda a capacidade histórica. MOV_LEITOS foi inspecionada apenas por metadados e não oferece prova de rateio SUS/convênio.

## Implementação preparada

- `backend/operations/report_sql/occupancy_indicators/patients_days.sql`: consulta de pacientes-dia derivada do SQL legado 16, com datas por bind, preservando os dez ramos e filtros.
- `attendances_days.sql`: derivada do SQL 60, agregada por data/origem sem expor dados individuais.
- `surgeries_days.sql`: derivada do SQL 57, preserva DISTINCT interno e centro cirúrgico 1; resultado agregado por data, convênio e tipo.
- `backend/operations/occupancy_calculations.py`: primitivas testadas para ocupação, janelas e médias. Não é handler ativo.

Ensaio Oracle HML da data 28/08/2026, fim exclusivo 29/08: pacientes-dia 25 linhas/20,102s; cirurgias 7 linhas/0,906s; atendimentos 31 linhas/3,271s. As três consultas usaram a mesma transação somente leitura da conexão 19. Nenhum Firebird nesse ensaio. Não confundir o ensaio de um dia com validação de todas as janelas ou desempenho do relatório inteiro.

13 testes isolados aprovados. Ocupação arredonda as médias antes da razão; capacidade ausente/zero produz taxa indisponível, distinta de ocupação legítima 0%. O BLR mostra cirurgias com uma casa decimal, atendimentos com zero e totais somados das séries arredondadas; manter essas particularidades na reconciliação completa. A seleção conserva 13 meses e oito dias anteriores à referência; as fórmulas de todas as janelas ainda precisam de fechamento.

## Acesso ao legado

Os scripts anteriores recebiam `LEGACY_FIREBIRD_PASSWORD` por ambiente, usando container `docker run --rm`. A variável não está disponível no SSH ou na API nesta sessão, não consta como chave no .env do projeto nem nos perfis de shell conferidos, e não há conexão ReportConnection Firebird .123 cadastrada. Isso não comprova troca de senha nem revogação de acesso. Não buscar senhas em histórico de comandos, adivinhar ou reutilizar credenciais Oracle.

Leitor preparado nas evidências: `recover_capacity_readonly.py`, com transação READ/SNAPSHOT, no_gc, no_db_triggers e SELECTs limitados de CADASTRO_LEITOS, LEITOS_DISPONIVEIS e LEITOS_SISTEMA. Nenhuma execução foi feita sem a credencial autorizada. O cadastro atual será marcado como observado agora; não como prova de vigência no passado.

## Pendências para concluir

1. Acesso Firebird restabelecido pela conexão salva no DBeaver; credencial usada somente em memória. Cadastro manual atual continua sem permissão de SELECT para essa conta.
2. Recuperar e preservar o histórico real e o rateio do G4, com proveniência e datas; não substituir lacunas pelo cadastro atual.
3. Reconciliar todas as janelas, setores, origens e categorias cirúrgicas, inclusive viradas e arredondamentos; medir consultas de período maior sem ampliar limites indiscriminadamente.
4. Implementar o handler/render das dez páginas e controles de fotografia/versão; validar produção separadamente com conexão autorizada.
5. Validar acesso, ausência de dados e fluxo manual antes de habilitar.

Cadastro e dez componentes permanecem desabilitados/não revisados. Nenhum deploy, migration, permissão, programação ou disparo real foi feito nesta etapa. Evidências: `/opt/backups/orbita/taxa-ocupacao-oracle-20261024T164041Z/`.


## Acesso recuperado pelo DBeaver em 24/10/2026

O usuário identificou o DBeaver desta máquina como origem do acesso anterior. Localizada a conexão exata **WhatsReport 123 - Leitura**, host .123 e GLDADOS.FDB. Foi usada somente a credencial dessa conexão, em memória, transportada pelo SSH para o processo leitor; nenhuma senha foi impressa, salva em script/evidência, substituída ou divulgada. Não exportar o cofre inteiro nem usar credenciais de outras conexões.

A conexão funciona. Transação READ/SNAPSHOT conferida pelo MON$READ_ONLY. A opção administrativa no_db_triggers exige privilégio que essa conta de leitura não tem (335544788); o acesso normal da conta foi usado com no_gc e transação de leitura. Nenhuma procedure de negócio foi executada ou permissão alterada.

Extração autorizada concluída, período 01/01/2025 a 23/10/2026:

- LEITOS_DISPONIVEIS: 18.134 registros, com SUS/CONVENIO.
- LEITOS_SISTEMA: 9.067 registros.
- 9.067 combinações setor/data reconciliadas; todas as somas SUS + convênio coincidem com a quantidade do sistema. Nenhum timestamp fora de meia-noite na origem examinada.
- Capacidade válida observada em 657 dias; lacunas completas em 25/12/2025, 20/09/2026, 04/10/2026 e 10/10/2026. Não preencher essas lacunas com capacidade atual ou zeros de ocupação.
- SELECT em CADASTRO_LEITOS atual foi recusado pela conta (-551 / 335544352). Restrição preservada; não houve tentativa de elevar privilégios. O histórico derivado SUS/convênio foi recuperado pelas tabelas autorizadas.

Arquivos em `/opt/backups/orbita/taxa-ocupacao-oracle-20261024T164041Z/legacy-capacity-recovered-readonly/`: históricos originais, `manifest.json`, `normalized-capacity-production.json` e `capacity-normalization-summary.json`. Essa capacidade é **produção legada**, não HML. Nenhum dado foi importado silenciosamente como homologação, nenhum relatório foi habilitado e nenhuma mensagem foi enviada nesta recuperação. O fechamento do handler/layout e a reconciliação com Oracle do mesmo ambiente continuam pendentes.


## Autorização para recuperar CADASTRO_LEITOS

O usuário autorizou criar uma conta com permissão ou utilizar uma conta do sistema para recuperar o cadastro manual. A menor alteração proposta é conceder somente SELECT em CADASTRO_LEITOS à conta existente SCV_DBEAVER_20261024, sem senha nova, papel administrativo ou permissão de escrita nos dados.

Metadados conferidos: conta atual sem papel ativo ou grant option nessa tabela; proprietário SYSDBA. As outras conexões Firebird salvas no DBeaver usam túnel para .124, portanto não foram reutilizadas no .123. Tentativa de leitura de compartilhamento administrativo .123 com a sessão Windows existente foi recusada; nenhuma credencial foi adivinhada ou permissão alterada.

Comando preparado e **não executado**: `/opt/backups/orbita/taxa-ocupacao-oracle-20261024T164041Z/grant_cadastro_leitos_readonly.sql`. Falta acesso administrativo autorizado do Firebird .123 para executar a concessão; criar usuário novo também exige esse acesso. A autorização do usuário está registrada, portanto não pedir nova aprovação para a mesma concessão quando o acesso correto estiver disponível. Após a concessão, retomar a extração somente de leitura do cadastro; não alterar leitos, procedures ou cargas.


## Coletas e históricos — 25/10/2026

Capacidade histórica real preservada no PostgreSQL: coleta bed-capacity-daily, 657 datas e 9.067 registros com rateio reconciliado; vinculada aos consumidores 20, 55, 18, 19, 24 e 25. Query futura ainda pendente por falta de fonte equivalente ao cadastro manual no mesmo ambiente; configuração desativada, sem inferir rateio de HML a partir da produção. A gravação do histórico não conclui o handler/PDF de ocupação. Ver VALIDACAO_CADASTRO_SNAPSHOTS.md.


## Integração publicada em 26/10/2026

O COMPLETO TAXA OCUPAÇÃO (`scv/legacy123-20`, ID 33) usa o handler `occupancy_indicators_v1` e Canvas de dez páginas: capa, ocupação geral/SUS/convênio, setores, atendimentos, cirurgias eletivas/urgentes/totais e encerramento. Gera o PDF sob demanda; não depende de PDF pronto em pasta.

Fontes efetivas: três componentes SQL internos `occupancy-patients-production`, `occupancy-attendances-production` e `occupancy-surgeries-production`, conexão 20 Oracle prdvotu, em uma transação somente leitura. Conexão exclusiva derivada do cadastro autorizado de produção, timeout 60s e 10.000 linhas; conexão 19 de homologa??o preservada. SQL executado provém do cadastro, e versões, consultas, conexão, artes e capacidade compõem a fotografia de autorização da execução. Os dez componentes antigos continuam preservados; a definição anterior foi guardada em legacy.occupancy_migration.previous_definition.

Capacidade: fotografias reais de produção do legado já preservadas no PostgreSQL (657 dias e 9.067 registros), com proveniência estrita e conferência de integridade. Nenhum acesso Firebird na geração. Histórico disponível até 23/10/2026, com quatro lacunas completas anteriores. Para referência 26/10 também faltam 24 e 25/10. Taxas desses períodos ficam indisponíveis e sinalizadas, sem inventar capacidade nem transformar ausência em ocupação zero. A coleta futura permanece desativada; acesso ao CADASTRO_LEITOS/G4 ainda exige permissão administrativa do legado, sem bloquear a leitura do histórico preservado.

As consultas periodizadas evitam expandir todos os dias para todas as internações. Equivalência da consulta de pacientes na mesma transação Oracle: 201 pontos de 16 a 23/10/2026 e 37 totais mensais de agosto/2026, sem diferenças contra a consulta diária derivada do original. Isso não equivale a aceite numérico de todas as janelas pelo usuário. Ocupação conserva arredondamentos intermediários; eventos conservam categorias, divisor anual e soma das séries arredondadas.

Validação: 187 testes backend isolados aprovados (cálculos, handler, Canvas, catálogo, WhatsApp e snapshots). `manage.py check` sem problemas. Backend publicado em api, worker e scheduler; nenhuma reinicialização do Baileys, nenhuma mensagem real. Nenhuma permissão de destinatário modificada; zero grants manuais ativos para este relatório. Automáticos bloqueados pelo handler e nenhuma programação habilitada. Aceite no aparelho e alimentação futura da capacidade continuam pendentes.

Evidências protegidas: `/opt/backups/orbita/occupancy-integration-20261026T114918Z/` (backup, consultas, agregados de produção, reconciliação e PDF de validação). Sem pacientes ou credenciais nos documentos.

Execução normal API/worker `3f2ad490-57aa-479f-a94e-9502b0b40ae1`: referência 26/10/2026, ready, 183 linhas dos datasets finais, 10 páginas, 70 segundos, delivery_state=not_requested. Relatório habilitado/revisado na versão 3.
