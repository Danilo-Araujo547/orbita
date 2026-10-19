# Confirmação por Flow sem endpoint

O administrador informou que a chave privada do Flow anterior não está disponível. Foi criado um novo Flow, sem `data_api_version`, `endpoint_uri` ou `data_exchange`. A ação terminal `complete` devolve decisão, observação e `flow_token` pelo webhook normal do WhatsApp. A chave registrada no número e os Flows anteriores permanecem preservados.

- Flow: `3743371309161826`, publicado, sem erros de validação.
- Template: `confirmacao_consulta_orbita_v2`, `pt_BR` (sujeito à aprovação da Meta).
- Definição: `backend/messaging/flows/confirmation_v2.json`.

O formulário recebe profissional e procedimento do snapshot do agendamento. A confirmação é vinculada pelo UUID da mensagem e validada contra unidade, canal, destinatário, template e contexto. Decisões inválidas ou vínculos incompatíveis exigem revisão; não são associados por aproximação do telefone. Observações são preservadas na resposta e no histórico do acompanhamento. Reentregas do mesmo evento são idempotentes.

O receptor público já instalado em `metapi.santacasavotuporanga.com.br` conserva os eventos assinados no PostgreSQL. Um worker local (`run_meta_inbox`) lê exclusivamente os eventos associados a mensagens do Órbita, via SSH e transação PostgreSQL somente de leitura. A assinatura original é verificada novamente usando o App Secret criptografado da unidade. Eventos de outras unidades, canais, mensagens e destinatários não são importados. O cursor só avança depois do processamento local confirmado.

Nenhum código, fila, encaminhamento ou configuração nginx do servidor receptor foi alterado. O recebimento não depende de expor o Django local na internet. A chave SSH já configurada no usuário Windows deve estar disponível ao worker; falhas de sincronização aparecem em `artifacts/inbox-error.log`, sem corpos de mensagens ou credenciais.

Configuração local: `META_INBOX_SSH_HOST`, `META_INBOX_SSH_USER`, `META_INBOX_CONTAINER`. O worker inicia e para com os scripts locais. `run_meta_inbox --once` executa uma sincronização controlada.

`scripts/configure_confirmation_v2.py` busca o catálogo da Meta e seleciona o novo template. Enquanto não aprovado, mantém a unidade pausada. Após aprovação, pode ser executado novamente para preparar as mensagens e reativar o piloto, sempre com liberação manual por grupo e o destinatário/limite já configurados. Não dispara nenhuma mensagem.

Mensagens antigas já enviadas mantêm o botão do Flow anterior. É necessário um novo envio autorizado para usar o novo formulário.
