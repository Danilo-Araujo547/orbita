# Regras de origem — AME

Fonte: extração somente de leitura do Firebird do servidor AMEVOTROB8, documentada em 11/10/2026 nos artefatos locais da investigação. Consulta: `TBRELATORIO` associada a `TBAGENDADOR_ENV_REL`, `A.STATUS='S'` e procedimentos contendo SINCRONIZAR ou LEMBRETE. Dentro dos três tipos desta versão, foram identificadas estas cinco tarefas:

| Código novo | Tipo | Antecedência | Horário de Brasília | Dias de execução | Relatório legado | Agendador legado |
|---|---|---:|---|---|---:|---:|
| consultation-d7 | Consultas | 7 dias | 07:15 | Segunda a sábado | 77 | 393 |
| exam-d7 | Exames | 7 dias | 07:30 | Segunda a sábado | 78 | 394 |
| lab-d7 | Laboratório | 7 dias | 07:35 | Segunda a sábado | 79 | 395 |
| exam-d3 | Exames | 3 dias | 07:20 | Segunda a quarta | 88 | 563 |
| exam-d4 | Exames | 4 dias | 07:25 | Quinta a sábado | 48 | 586 |

O dia da semana é o da **execução/importação**, e não o dia do agendamento. As regras são um retrato do cadastro extraído, não uma prova de execução histórica. A presença de tarefas não ativas no cadastro antigo não implica sua ativação no novo robô.

## Seleção Oracle

| Tipo | View |
|---|---|
| Consulta | DBASISTEMAS.VDIC_CONSULTA_AGENDA_ENVIO_MSG |
| Exame | DBASISTEMAS.VDIC_EXAME_AGENDA_ENVIO_MSG |
| Laboratório | DBASISTEMAS.VDIC_LAB_AGENDA_ENVIO_MSG |

Preservados: `DTA_AGENDA` igual à data local de execução mais a antecedência; `CELULAR IS NOT NULL`; `CD_AGENDA NOT IN (SELECT CD_AGENDA FROM DBASISTEMAS.TBL_LOG_MEGA_MSG WHERE SN_ENVIADO='S')`. A aplicação não escreve nesse log. Logo, o que o robô atual registrar nele pode alterar a seleção observada no ambiente de teste.

## Mapa do lembrete

| Variável | Campo normalizado | Origem observada |
|---:|---|---|
| 1 | patient | CROSS — nome e nascimento no legado |
| 2 | appointment_type | TIPO_CONSULTA; laboratório usa a constante do gatilho de coleta |
| 3 | procedure | ESPECIALIDADE |
| 4 | date | DTA_AGENDA, dd/mm/aaaa |
| 5 | arrival_time | HORA_CHEGADA |

O mapa foi confirmado no cadastro local do template `lembrete_paciente`; seu texto exato e aprovação no novo canal devem ser conferidos na Meta. O campo Oracle `MENSAGEM` não é usado para montar o payload: o robô novo usa os campos separados. Não são reproduzidas as procedures que escrevem na fila Firebird.

## Diferenças deliberadas no ambiente de teste

Dados reais são apenas analisados. Contatos múltiplos são bloqueados para revisão, sem escolher o último telefone retornado. Falhas incertas não são reenviadas automaticamente. O prazo padrão de ausência de resposta é uma configuração nova: 24 horas da entrega confirmada, com agendamento ainda futuro. Não foram implementados lembretes adicionais para confirmados, cobrança de resposta, pós-cirúrgico ou prestadores.
