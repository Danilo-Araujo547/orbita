# Exames por atendimento — Oracle e Canvas

Integração em 26/10/2026 do relatório SCV 63 (`legacy123-53`, EXAMES POR ATENDIMENTO - COMPLETO), substituindo a composição legada 42/52. O relatório permanece desativado para envio, com permissão manual de Danilo -- STI preservada/cadastrada. Não foi criada programação automática; o handler bloqueia origem automática até homologação própria.

## Dados e regra

- Origem: Oracle produção `172.16.0.254:1521/prdvotu`, conexão 1; somente SELECT em transação READ ONLY.
- Fontes originais 33 (ATENDIMENTOS) e 35 (EXAMES), agora com parâmetros de período e consultas editáveis no SCV. Conferência 01–24/10/2026: 428 linhas/1.744 atendimentos; 555 linhas/3.748 exames. Resultados equivalentes ao SQL legado completo com filtro externo no mesmo período.
- Dois novos componentes agregados, `exams-attendance-exams-source` (362) e `exams-attendance-visits-source` (363), usam as mesmas consultas, somadas por mês/prestador e por dia nos últimos oito dias. Essas consultas também são editáveis no SCV.
- Preservados os filtros de urgência, convênio 2 e exclusão de origem 46 onde presentes no SQL recuperado; não representar essas contagens como toda a produção hospitalar.
- O nome de prestador vem da própria fonte de exames, sem equivalência por semelhança nem deduplicação por telefone. Participam prestadores com soma de exames no ano atual; ordenação decrescente por exames no ano atual. Empates têm desempate por nome para estabilidade. Denominador zero resulta em zero no resumo e célula vazia na série individual, como o ramo legado. Razão é soma dos exames / soma dos atendimentos, arredondada em duas casas; não é média simples de razões diárias.
- Meta **2,50**, confirmada ao vivo em GLDADOS.FDB, DEFGER2.META_EXAMES_ATENDIMENTO, conta técnica e transação READ ONLY/SNAPSHOT. O layout legado também registra “Meta 2,50”. Valor versionado no primeiro item de `components` do relatório 53, propriedade `goal`; sua alteração deve passar pela edição versionada da definição, não por pergunta ao destinatário.
- Janelas: dois anos, 13 meses até o mês da referência e oito dias anteriores à referência. O único parâmetro do relatório é `data_referencia`, opcional; em branco usa hoje no fuso da unidade. Datas futuras e anteriores a 2024 são rejeitadas.

## Diferença importante em relação à investigação inicial

CADASTRO_PRESTADORES não é lista manual fixa para esse fluxo. O BLR mostra DELETE, INSERT e UPDATE nessa tabela auxiliar durante a geração da procedure PROC_EXAMES_POR_ATENDIMENTO. Ela é reconstruída a partir dos nomes de EXAMES; o tipo 4 a preenche com as duas linhas Exames/Atendimentos. A tabela de dados tem campos de nome de 100 caracteres e a auxiliar antiga limita a 50; os nomes verificados nesta comparação têm no máximo 40. Nomes futuros acima de 50 exigem revisão, sem truncamento silencioso.

A procedure de negócio **não foi executada** nesta etapa: a reconstrução usa BLR estático e SELECTs agregados. Não houve alteração de tabelas, usuários, permissões ou arquivos no legado. A credencial técnica foi usada apenas em memória; não consta dos artefatos.

## Reconciliação e visual

Snapshot de leitura do Firebird preservado: ano 2025 e 2026 até 24/10, agregados mensais e diários por prestador. Comparado com a leitura Oracle na mesma data de corte, ignorando apenas a hora do timestamp do agrupamento. Todas as chaves e quantidades coincidiram. Foram conferidas também as tabelas calculadas e a meta; isso não significa que a procedure original tenha sido executada para comparação.

Referência de validação: 25/10/2026 (ambas as fontes legadas atualizadas até 24/10). Resultado: 178 prestadores, 23 períodos, seis páginas no Canvas. Layout editável com resumo/gráfico e tabela de prestadores paginada. Cabeçalho indica a menor atualização efetiva das duas fontes. A rotina de produção passa a ler apenas Oracle; não utiliza Firebird em tempo de geração.

Regressão: 150 testes aprovados, incluindo cálculo ponderado por contagens, denominador zero, seleção e ordenação de prestadores, virada de ano, ano bissexto, meta, isolamento de unidade, revisão de origem, coleta única por geração e bloqueio de automação. Conferidas visualmente a página de resumo e a tabela de prestadores.

## Operação

O componente tem período de consulta configurável e limite de linhas de 10.000 na conexão, mantendo limite de tempo e tamanho. O antigo limite de 1.000 não comportava os agregados: 1.956 de exames e 1.868 de atendimentos na comparação de duas janelas anuais. Uma conexão Oracle é compartilhada pelos dois SELECTs dentro da transação de leitura.

Definição, metadados, consultas, hashes, teste, leitura Firebird agregada, backup anterior e PDF de validação em `/opt/backups/orbita/exams-attendance-20261026/`, com permissões restritas. A meta e as consultas são verificadas na fotografia de cada geração; mudanças de versão invalidam execuções antigas.

Planilha principal: https://docs.google.com/spreadsheets/d/13aQJVPIKGuBpi94uvPoQiA0SQo_14NrMDZijqec_YLM/edit. Atualizar sempre esse acompanhamento após cada avanço.
