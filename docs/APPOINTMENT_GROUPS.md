# Grupos de agendamentos

A aba Grupos substitui Respostas no menu. A lista fica em `/grupos`; o detalhe fica em `/grupos/{uuid}`. Os caminhos permitem recarregar, abrir diretamente e navegar para trás/para frente. A unidade é preservada no parâmetro `unit`. A API de respostas anterior permanece compatível.

Um grupo reúne unidade, tipo, data local do atendimento, regra e versão da regra. Lembretes de sete e três dias são grupos distintos. A data/hora de envio inicial vem da geração da fila, respeitando a regra ou o horário explicitamente utilizado na simulação. Alterar a programação do grupo não altera a consulta nem o hospitalar.

Os totais de agendamentos usam identificadores distintos, não telefones. Um agendamento com dois números aparece uma vez; suas duas mensagens contam separadamente. A coluna Enviados conta agendamentos com ao menos uma mensagem aceita pelo provedor. Mensagens mostra aceitas/enviadas/entregues/lidas sobre o total de destinos; não significa que todas foram entregues. O detalhe separa mensagens entregues/lidas. Somente a revisão atual dos agendamentos entra nos totais.

Administradores podem editar data/hora em Brasília e intervalo de 0 a 3.600 segundos. O horário deve ser futuro e anterior ao atendimento. A edição exige versão e chave de idempotência; conflito retorna 409. Os envios em análise, na fila e bloqueados recebem o novo horário; enviados, incertos e falhas não são reenviados. A pausa da unidade e todas as verificações de envio continuam valendo.

Cada destino ocupa um intervalo dentro do grupo. Workers reservam a próxima janela de forma transacional, antes de chamar o transporte. O intervalo é mínimo entre inícios de envio; tempo de transporte, indisponibilidade e frequência de execução podem aumentar a espera. O Celery Beat verifica a fila a cada segundo; o ambiente local continua com execução manual e sem liberação de envios reais. Grupos diferentes têm intervalos independentes.

Novos membros respeitam a programação editada, inclusive quando uma importação coincide com a edição. O dispatch reconcilia a programação de mensagens ainda sem tentativa. Cada envio preserva no snapshot o grupo, versão, horário e intervalo usados. As alterações de programação têm auditoria. Mensagens originais e respostas não são apagadas.

## API

- `GET /api/v1/appointment-groups/?unit=ame`: lista paginada; filtros `kind`, `start` e `end` pela data do atendimento.
- `GET /api/v1/appointment-groups/{id}/?unit=ame`: resumo do grupo.
- `POST /api/v1/appointment-groups/{id}/schedule/?unit=ame`: `version`, `scheduled_for` ISO com fuso e `delay_seconds`; requer `Idempotency-Key`.
- `GET /api/v1/appointments/?unit=ame&group={id}`: agendamentos únicos, com os filtros existentes. Exportações usam o mesmo escopo.
- `GET /api/v1/appointments/{id}/communications/?unit=ame&group={id}`: mensagens do grupo e registros manuais do acompanhamento.

A unidade é verificada no backend em cada recurso, inclusive comunicação, exportação e edição. Operadores e usuários de consulta têm leitura; alteração da programação requer administrador.

As migrations `messaging.0008` e `0009` acrescentaram os grupos e vincularam as mensagens existentes, sem apagar dados. Backup anterior: `artifacts/groups-migration-20261014-005038/before.dump`.
