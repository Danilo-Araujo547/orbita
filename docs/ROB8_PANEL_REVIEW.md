# Inspeção do painel ROB8 em operação

Observação de interface em 12/10/2026. Inspeção somente de leitura, sem disparos ou alteração de cadastros. Não foram copiados dados identificáveis de pacientes.

## Confirmado na interface

- Versão exibida: Gerencial 4 WEB 1.108, Mega Online Software.
- Cadastros: Usuários, Preparos, Tipos de Envio.
- Painéis: Agendamentos, Transferir Agenda, Cancelar Agenda, Reagendamento, Dashboard, Status Robô.
- Colunas da listagem: tipo, especialidade, paciente, cidade, telefone, data/hora e profissional.
- Detalhe de comunicação com mensagem, resposta e observação. Foi visto um registro com resposta “NÃO CONHEÇO ESSA PESSOA”. A interface por si só não comprova como o texto foi interpretado no backend.
- Pesquisa, impressão e exportação disponíveis. Impressão e exportação não foram acionadas.

## Filtros

| Dimensão | Opções observadas |
|---|---|
| Tipo de período | Data Agendamento, Data Resposta, Data (Outras) |
| Tipo de envio | Agendamentos, BUSCA ATIVA CDR, Busca Ativa, CONVOCAÇÃO CDR, Reagendamento, Transferência de Agendamentos |
| Resposta | Não receberam a mensagem; Não responderam; Não conheço essa pessoa; Recusadas por WhatsApp; Recusadas por Telefone; Confirmadas por WhatsApp; Confirmadas por Telefone; Pendentes; Não comunicado sobre o agendamento; Todos |
| Situação da agenda | Em aberto, Encerrados, Transferidos, Cancelados, Todos |
| Tipo assistencial | Consultas, Exames, Laboratório, Procedimentos, Todos |
| Forma de envio | WhatsApp Web, WhatsApp Premium, Todos |
| Tipo de agendamento | 1ª Consulta, Retorno, Interconsulta, Todos |
| Observação | Com observação, Sem observação, Ligação não atendida, Todos |
| Busca complementar | Cidade; Paciente/Médico |

A legenda separa números válidos/inválidos, presença de observação, ligação não atendida, confirmação/recusa por WhatsApp e confirmação/recusa por telefone.

## Consequências para o novo sistema

Separar entidades e estados em vez de concentrar tudo em um único campo de resposta:

1. **Entrega da comunicação**: não enviado, aceito, entregue, falhou e resultado incerto.
2. **Resposta do destinatário**: confirmação, recusa, desconhece o paciente, resposta livre e ausência de resposta no prazo.
3. **Atendimento da equipe**: tentativas de ligação, ligação não atendida, confirmação/recusa por telefone, observações e histórico auditável.
4. **Situação do agendamento**: aberto, encerrado, transferido, cancelado; a origem e a sincronização precisam ser comprovadas antes de automatizar mudanças.
5. **Finalidade da comunicação**: lembrete, busca ativa, convocação, transferência e reagendamento.

O primeiro módulo já possui fila, eventos de entrega, respostas e pendências. Faltam campos estruturados para os contatos telefônicos, classificação explícita de destinatário que desconhece o paciente, tipo de consulta e profissional/cidade, além dos módulos posteriores de preparos e movimentação de agenda. A existência dos menus não confirma integração de escrita com o hospitalar.

## Preparos e configuração dos textos

Após o usuário restabelecer a sessão, foram consultados os cadastros. Há **281 registros de preparos** na listagem. O formulário possui seleção de exame (`CEXAME`) e texto de preparo (`EPREPARO`). Foi aberto um preparo existente e fechado com Cancelar, sem salvar. A presença do cadastro não comprova, sozinha, o momento em que esse texto entra no envio.

O cadastro possui **12 tipos de envio**. Cada formulário contém nome do tipo, “Texto gravado no banco de dados” (`EFILTRO`), “Nome do Template para aviso de inclusão” (`ELEMBRETE`), “Apresentar nas Pesquisas” e texto “Template” (`EMENSAGEM`). Todos foram consultados e fechados com Cancelar. `ELEMBRETE` estava vazio nos 12 tipos. Portanto, essa tela **não identifica o nome do template aprovado na Meta**.

| Tipo | Texto gravado no banco | Apresentar nas pesquisas | Conteúdo do modelo cadastrado |
|---|---|---|---|
| Agendamentos | CONFIRMA AGENDAMENTO AME VOTUPORANGA | Sim | Lembrete com paciente, tipo/procedimento, data e chegada; pede confirmação; orienta considerar o primeiro horário quando houver vários agendamentos |
| Ausentes | MOTIVO AUSENCIA | Não | Solicita motivo da ausência; inclui especialidade, profissional, data e horário |
| BUSCA ATIVA CDR | BUSCA ATIVA CDR | Sim | Pergunta se deseja continuar aguardando a vaga na fila |
| Busca Ativa | PÓS CIRÚRGICO | Sim | Campo de mensagem vazio |
| CONVOCAÇÃO CDR | CONVOCAÇÃO CDR | Sim | Pede ligação para a unidade e contém marcador `#PROTOCOLO#` |
| Cancelamento de Agendamentos | CANCELAMENTO | Não | Avisa cancelamento |
| Lembrete Confirmado por Telefone | LEMBRETE SIM POR TELEFONE | Não | Confirmação registrada pelo atendimento, com orientação sobre encaminhamento na primeira consulta |
| Lembrete Recusado por Telefone | LEMBRETE NAO POR TELEFONE | Não | Informa que o atendimento não confirmou o agendamento |
| Lembrete de Exclusão | LEMBRETE EXCLUSAO | Não | Avisa cancelamento |
| Pesquisa NPS | PESQUISA NPS | Não | Pesquisa de experiência; texto cita **Sansaúde**, embora este painel seja da AME |
| Reagendamento | REAGENDAMENTO | Sim | Data/horário anterior e novo; pede resposta 1 SIM, 2 NÃO, 3 NÃO CONHEÇO ESSA PESSOA |
| Transferência de Agendamentos | TRANSFERENCIA | Sim | Data/horário original e novo horário de chegada |

Esses são textos configurados, não evidência de execução atual de todos os fluxos. “Apresentar nas pesquisas” indica exposição na interface; não deve ser interpretado como ativação de envio sem confirmar o backend. Alguns modelos contêm sequências literais `\\uD83D...`, apontando uma diferença de representação dos emojis que precisará ser tratada na migração.

### Marcadores observados

O modelo de Agendamentos contém `PARAM6`, `PARAM14`, `PARAM7`, `PARAM3` e `PARAM12`. Pela posição no texto, a interpretação provável é paciente, tipo de atendimento, procedimento/especialidade, data e horário de chegada, respectivamente. Outros modelos usam `PARAM8` (profissional) e `PARAM9` (horário). Isso é inferência a partir do texto, ainda não confirmação do código de substituição.

`PARAM19` e `PARAM20` precisam de atenção: no modelo de Reagendamento representam data/horário anteriores; no de Transferência representam a nova data/horário de chegada. A nova aplicação deve usar nomes semânticos explícitos, por exemplo `previous_date` e `new_arrival_time`, com mapas específicos por finalidade, sem presumir que o mesmo índice significa sempre a mesma coisa.

## Dashboard

A tela separa indicadores de **mensagens** e de **agendamentos/pacientes**, com filtros de período e número de envio. Indicadores observados: mensagens a enviar, agendamentos recusados, total de mensagens, respondidas/não respondidas, enviadas, números inválidos, total de agendamentos e respectivas taxas. Os valores não foram usados para inferir atividade, pois dependem de pesquisa/período. Não foi confirmada a definição dos denominadores ou a deduplicação de pacientes.

## Inspeção pendente e limites

Ao abrir “Status Robô”, a aplicação retornou ao login; a causa não foi confirmada. A sessão foi restabelecida pelo usuário. Houve respostas lentas da aba durante a navegação, com recuperação posterior. A tentativa de abrir Transferir Agenda terminou exibindo a listagem comum, sem formulário de transferência confirmado.

Permanecem pendentes: tela de status, formulários efetivos de transferência/cancelamento/reagendamento, vínculo entre preparos e envio, interpretação dos marcadores no código, gatilhos de inclusão dos tipos e regras exatas das ações manuais. Não foram executados envios, gravações, exclusões ou operações de agenda. A existência dos menus não comprova escrita no hospitalar.
