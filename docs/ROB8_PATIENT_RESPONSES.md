# Respostas e observações no ROB8

Verificação somente de leitura em 12/10/2026. Nenhuma observação salva, resposta alterada ou mensagem enviada. Documento sem conteúdo identificável de pacientes.

## Evidências do painel 172.16.0.123

- Detalhe de comunicação apresenta mensagem, resposta e observação.
- Filtros distinguem confirmação/recusa pelo WhatsApp, confirmação/recusa por telefone, desconhecimento do paciente, não recebimento e ausência de resposta.
- A ação Inserir observações abre Observação do Agendamento. Campo EOBSERVACAO_AGENDAMENTO com maxlength=4000 e checkbox ECHECK_LIGACAO_CHECKBOX, legenda Ligação não atendida. Formulário fechado com Cancelar, sem preencher ou gravar.
- Existe controle Histórico Observação no DOM, indisponível nos registros atualmente exibidos. Não foi confirmado o armazenamento físico do histórico nem seu conteúdo.

## Campos e rotinas encontrados

Em fragmentos extraídos do G4LightWEB.exe de 172.16.0.123:

| Campo TBAVISOS | Uso evidenciado |
|---|---|
| RESPOSTA | Classificação da resposta e filtros operacionais |
| DATA_RESPOSTA | Filtro/ordenação por data de resposta |
| OBSERVACAO_AGENDAMENTO | Filtros com/sem observação; formulário tem nome correspondente |
| LIGACAO_NAO_ATENDIDA | Filtro por valor S |
| PACIENTE_ENCERROU | Gravação no encerramento por telefone; validação pede pessoa com quem falou |
| USUARIO_ENCERROU | Gravação do usuário no encerramento |
| OBSERVACAO_ENCERROU | Gravação de observação do encerramento |

A rotina de encerramento por telefone contém validações de nome do interlocutor e observação. O UPDATE recuperado filtra SEUID e exclui tipos contendo LEMBRETE, além de restringir respostas anteriores. Como são fragmentos de strings, não foi reconstituída toda a condição nem comprovado o alcance final na execução.

Em ações do Firebird BASE.FDB de 172.16.0.124, os botões SIM/NÃO possuem SQL que atualiza TBAVISOS.RESPOSTA, SELECT_BUTTON_ID, ACK=3, STATUS_MENSAGEM='Visualizada', NOME_CONTATO_RESP e CELULAR_CONTATO_RESP, usando SEUID=PARAM1. Há também exclusão de lembretes ainda não enviados com SEUID prefixado por L. Essas ações são evidência dessa instalação; não comprovam configuração idêntica no painel de 172.16.0.123.

As ações de desconhecimento do paciente examinadas não têm SQL adicional habilitado. A presença de respostas desse tipo no painel não esclarece, por si só, qual rotina central as grava.

## Ausência de resposta

Os fragmentos distinguem:

- Não receberam: RESPOSTA IS NULL, IDMENSAGEM IS NULL e STATUS_MENSAGEM IS NULL.
- Não responderam: RESPOSTA IS NULL, IDMENSAGEM IS NOT NULL e STATUS_MENSAGEM IS NOT NULL.
- Pendências: em outro fragmento, RESPOSTA IS NULL, STATUS IS NULL e LIGACAO_NAO_ATENDIDA IS NULL.

São critérios locais de classificação. Não comprovaram entrega real ou um prazo de expiração. A ausência de resposta não é uma recusa.

## Implicações para reconstrução

1. Separar evento recebido original, classificação de resposta, situação de entrega e atendimento humano.
2. Interpretar SIM/NÃO pela finalidade: confirmação de agenda, permanência em fila CDR ou acompanhamento pós-cirúrgico. SIM no pós-cirúrgico indica a resposta ao estado do local do procedimento, conforme texto do modelo, não confirmação de agendamento.
3. Vincular a resposta à mensagem/campanha e ao evento de origem, não apenas ao telefone. O legado usa SEUID nas ações verificadas; telefones podem ser compartilhados e há vários avisos por evento.
4. Registrar observações e tentativas de contato como eventos com autor/data/canal, preservando histórico e correções.
5. Distinguir número tecnicamente inválido de destinatário que não conhece o paciente.
6. Configurar prazo para sem resposta e guardar mudanças de classificação sem apagar o texto original.
7. Resposta livre ou ambígua precisa de pendência para equipe; não foi comprovada interpretação automática de texto livre no legado.

## Limites

Não foi confirmado se o ROB8 guarda todas as mensagens recebidas, áudios, anexos ou versões de observações, nem como interpreta texto livre ou correlaciona mensagens recebidas simultâneas. DATA_RESPOSTA existe nos fragmentos, mas sua rotina de preenchimento não foi identificada. O SQL de resposta por botão verificado também modifica indicadores de visualização; portanto esses campos não devem ser tratados como prova independente de entrega/visualização.

Fontes locais: Busca_Ativa_123_Consultas_Executavel.txt, Firebird_Acoes_Confirmacoes.txt, ROB8_PANEL_REVIEW.md e inspeção dos controles visíveis do painel.
