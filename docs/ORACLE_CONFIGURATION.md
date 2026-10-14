# Configuração Oracle por unidade

Em **Configurações → Oracle → Adicionar conexão Oracle**, o administrador informa host, porta, service name ou SID, usuário, senha Oracle, limite de consulta e sua senha atual do Órbita. Os campos ficam em modal. A configuração é exclusiva da unidade selecionada.

Todos os dados da conexão são armazenados em um único payload Fernet autenticado. A chave é derivada da senha atual do administrador com scrypt (N=32768, r=8, p=1, 32 bytes) e salt aleatório de 16 bytes por gravação. O PostgreSQL armazena somente ciphertext, salt, autor, versão e estados de validação. Nenhuma senha é escrita no histórico ou nos recibos de idempotência. A senha Oracle é somente de escrita na API.

Salvar exige validar a senha do usuário autenticado e o papel administrador da unidade. Não basta conhecer a senha de outro usuário. A API usa versão concorrente, responde 409 para versão obsoleta e exige Idempotency-Key nas ações. Repetir uma ação não executa novamente nem renova o desbloqueio.

## Desbloqueio operacional

Salvar desbloqueia por 12 horas. A senha do administrador é descartada; somente a chave derivada permanece em uma concessão temporária. No ambiente local sem Redis, a concessão fica apenas na memória do processo da API; expiração ou reinício bloqueiam a conexão. Outros processos locais não herdam essa memória.

Quando ASYNC_TASKS/REDIS_URL estão configurados, API e workers compartilham a concessão via Redis com TTL. A chave temporária também é criptografada com INSTANCE_CREDENTIALS_KEY antes de entrar no Redis. É necessário manter o mesmo INSTANCE_CREDENTIALS_KEY e ORBITA_INSTANCE_ID nos processos da mesma instância. O Redis deve ser dedicado, protegido e acessível somente aos serviços. Um reinício da API não elimina concessões ainda válidas no Redis.

Essa concessão permite consultas sem reintroduzir a senha a cada tarefa: durante sua validade, um servidor com acesso ao Redis e à chave da instância consegue consultar o Oracle. O banco PostgreSQL isoladamente não contém essa chave temporária. A concessão não transforma a senha do administrador em um segredo recuperável.

**Bloquear** remove a concessão: novas consultas falham; uma consulta já em andamento pode terminar. Mudar a senha do administrador invalida sua concessão. Será necessário recadastrar os dados Oracle com a senha nova, pois a senha antiga não é recuperável. Somente o autor pode desbloquear; outro administrador da unidade pode substituir a configuração completa usando sua própria senha e todos os dados Oracle.

Uma configuração cadastrada e bloqueada nunca usa silenciosamente a credencial antiga das variáveis de ambiente. Sem cadastro no painel, a integração existente por ambiente continua funcionando. Esta tela não migra automaticamente segredos do ambiente.

## Teste e integração

**Testar conexão** executa SET TRANSACTION READ ONLY e SELECT 1 FROM DUAL, com rollback, timeout de conexão de 5 segundos, sem retentativas e limite de chamada configurável (1–120 segundos). Não consulta pacientes, não importa agendamentos nem dispara notificações. Erros do driver não são devolvidos ao cliente porque podem conter dados da conexão.

O modo Thin/Thick e o diretório do Instant Client continuam sendo configurações do servidor: a biblioteca Oracle define o modo para o processo inteiro. A tela mostra o modo ativo. Os conectores de agendamentos e pós-cirúrgico usam o cadastro por unidade; views e regras continuam dependendo de suas configurações verificadas separadas.

A configuração Oracle deve ser realizada diretamente na instância de origem, com sessão de administrador; chaves de federação não delegam acesso ao cofre nem recebem a senha do administrador pelo proxy.

## API

- GET /api/v1/oracle-configuration/?unit=slug: estado; host/usuário apenas enquanto desbloqueado; nunca senhas.
- POST configure/: version, host, port, identifier_type (service/sid), identifier, username, password, timeout_ms, admin_password.
- POST unlock/: version, admin_password.
- POST lock/ e test/: version.

Use HTTPS ao disponibilizar o painel fora do desenvolvimento local: a senha precisa chegar ao servidor para a derivação. Backups devem preservar o ciphertext e salt. Após restauração, desbloqueie com a conta e senha que protegeram o cadastro ou recadastre todos os dados. Os envios reais do WhatsApp continuam bloqueados.
