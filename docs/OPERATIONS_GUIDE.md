# Guia de acompanhamento

## Agendamentos e correções

Selecione a unidade no topo. Agendamentos tem uma linha por agendamento: paciente, procedimento/data, todos os contatos, entrega por número, resposta consolidada e intervenções. Filtre por tipo, entrega, resposta, correções ou observações; o período pode representar agendamento, envio previsto ou resposta. A exportação aplica os mesmos filtros, limitada a 10.000 registros.

Abra o paciente pelo botão da linha para consultar exatamente aquele agendamento, origem, comunicações e histórico. Observações abre um modal sobre a lista para consultar e registrar até 4.000 caracteres, sem navegar para outra tela. Ligações e classificações ficam no detalhe do agendamento. Ligação atendida exige interlocutor; havendo vários números, escolha o contato utilizado. Autoria e horário permanecem no histórico. Alterações concorrentes retornam 409; atualize e repita a ação.

Não existe assumir, transferir, concluir ou reabrir paciente. Correções reúne somente ações que exigem revisão e permite registrar a resolução, com acesso ao agendamento de origem. Sem resposta é uma situação para filtro, não cria uma correção automaticamente. Correções antigas continuam preservadas.

Cada notificação gera uma entrega por número distinto, com tentativas e respostas independentes, sem duplicar paciente ou agendamento. Uma confirmação em qualquer contato mantém o agendamento confirmado, mesmo se outro contato recusar. As respostas individuais são preservadas. Essa prioridade vale para agendamentos; as outras finalidades mantêm suas regras contextuais. Número incorreto e opt-out são aplicados ao contato correspondente. Pacientes só são vinculados por unidade, sistema e identificador de origem, nunca por nome ou telefone compartilhado.

Pendências não inclui agendamentos confirmados nem quem apenas aguarda resposta. Falhas de entrega, respostas para revisão e ausência de resposta no prazo continuam visíveis com o motivo correspondente. O filtro é aplicado no servidor antes da paginação e também na exportação. Para atualizar resultados antigos após essa mudança de regra, execute `manage.py reconcile_appointment_confirmations`; o comando registra a revisão e preserva o histórico.

SIM continua contextual: confirmação de agendamento, permanência na fila ou informação de que está bem após o procedimento. Respostas preocupantes do pós-cirúrgico exigem avaliação da equipe, sem diagnóstico automático.

Para revisar um contato, escreva a justificativa no formulário e selecione a situação no resumo. Número inválido, destinatário incorreto e pedido para não receber mensagens são situações distintas.

## Mensagem e resposta na lista

**Ver mensagem** abre um modal com o conteúdo preservado do envio, destinatário, número de origem quando registrado, situação e respostas recebidas. O seletor permite conferir mensagens e números do mesmo agendamento. Respostas mostram texto original, data/hora com segundos, nome de perfil recebido do WhatsApp e contato. Nomes não são deduzidos do cadastro do paciente; informações ausentes ficam explicitamente não informadas. Prévia/fila não é apresentada como envio confirmado.

**Confirmar / recusar** aparece para operadores/administradores quando o agendamento ainda aguarda resposta ou ultrapassou o prazo. O modal permite escolher Confirmado/Recusado, canal Telefone/WhatsApp, contato, pessoa que respondeu, data/hora e anotação opcional. É registro de um retorno recebido: não dispara mensagens nem altera o hospitalar. O usuário registrador fica identificado separadamente da pessoa que respondeu. Se chegar outra resposta durante a edição, o backend retorna 409 e mantém o histórico.

Registros manuais ficam separados de respostas recebidas pelo provedor; não criam um webhook ou Reply fictício. O resultado e o botão da lista são atualizados depois de salvar.

## Campanhas e CROSS

Um administrador cadastra o layout com os nomes exatos das colunas e referência da validação. A planilha precisa de identificador, nome, telefone e data em formato ISO. Configurações diferentes devem ser cadastradas por unidade.

Em Campanhas, envie CSV/XLSX, consulte a prévia e corrija erros antes de confirmar. A confirmação cria acompanhamentos, sem enviar mensagens. Reimportar o mesmo arquivo não duplica os acompanhamentos. Desaparecer de uma planilha não remove alguém da fila.

Depois, crie um rascunho, selecione acompanhamentos e template da mesma finalidade e prepare a prévia. As mensagens continuam em análise. Templates de demonstração não representam aprovação da Meta.

## Movimentações

No detalhe do agendamento, registre a solicitação. A equipe faz a alteração no hospitalar. Somente depois registre a evidência e os dados finais. Cancelamentos não exigem nova data; transferência/reagendamento exigem data e horário com fuso. A confirmação invalida a versão anterior e prepara uma comunicação em análise.

## Relatórios

Escolha relatório, período e formato em Relatórios. O resultado fica disponível para download quando a geração terminar. Revogar acesso impede novo download, mesmo quando o arquivo já estava pronto.

Em Administração, vincule usuário, número e relatórios permitidos. Registre como a titularidade foi conferida antes de confirmar a autorização. Pedidos por WhatsApp usam a palavra RELATORIO seguida da chave cadastrada; o acesso é verificado a cada pedido. O retorno real pelo WhatsApp depende da homologação do canal.

Relatórios externos indisponíveis exibem o motivo. Eles não executam procedures ou SQL arbitrário.

## Administração e validação

Novas unidades começam pausadas, sem regras hospitalares copiadas. Cadastre sua equipe, fontes, layouts e preparos. As credenciais de conexão ficam no ambiente do servidor.

O ambiente atual continua em simulação/análise. O histórico do ROB8 não foi importado, e os bancos legados não foram alterados. A liberação real depende das validações descritas em EVOLUTION_STATUS.md.
