# Configuração Oracle por unidade

Em **Configurações → Oracle → Adicionar conexão Oracle**, o administrador informa host, porta, service name ou SID, usuário, senha Oracle, limite de consulta e sua senha atual do Órbita. Os campos ficam em modal. A configuração é exclusiva da unidade selecionada.

Todos os dados da conexão são armazenados em um único payload Fernet autenticado. A chave é derivada da senha atual do administrador com scrypt (N=32768, r=8, p=1, 32 bytes) e salt aleatório de 16 bytes por gravação. Para acesso contínuo, essa chave derivada é novamente criptografada por `ORACLE_CREDENTIALS_KEY`, exclusiva do servidor e mantida fora do banco. O PostgreSQL armazena apenas conteúdo e chave encapsulada criptografados, salt, autor, versão e estados. Nenhuma senha é escrita no histórico ou nos recibos de idempotência. A senha Oracle é somente de escrita na API.

Salvar exige validar a senha do usuário autenticado e o papel administrador da unidade. Não basta conhecer a senha de outro usuário. A API usa versão concorrente, responde 409 para versão obsoleta e exige Idempotency-Key nas ações. Repetir uma ação não executa novamente nem renova o desbloqueio.

## Desbloqueio operacional

Salvar ativa o acesso contínuo, sem expiração. A senha do administrador é descartada; a chave derivada encapsulada permite que API e workers independentes consultem o Oracle após reinícios, sem Redis. A troca da senha do administrador não interrompe conexões com acesso contínuo.

Registros antigos, ainda sem chave encapsulada, mantêm compatibilidade com a concessão temporária de 12 horas em memória/Redis. A primeira ativação com a senha que protegeu o cadastro migra esse registro para acesso contínuo. A migração local autorizada também pode usar `scripts/enable_oracle_continuous_access.py`.

O banco PostgreSQL isoladamente não contém a chave do servidor necessária para abrir a chave encapsulada. Não é armazenada uma senha recuperável do administrador. Chave do servidor ausente/incorreta ou dados corrompidos impedem o acesso, sem fallback silencioso.

**Desativar conexão** é uma ação explícita, persistida e respeitada por todos os processos; uma consulta já em andamento pode terminar. **Ativar conexão** exige a senha atual do administrador responsável. Outro administrador da unidade pode substituir a configuração completa usando sua própria senha e todos os dados Oracle.

Uma configuração cadastrada e bloqueada nunca usa silenciosamente a credencial antiga das variáveis de ambiente. Sem cadastro no painel, a integração existente por ambiente continua funcionando. Esta tela não migra automaticamente segredos do ambiente.

## Teste e integração

**Testar conexão** executa SET TRANSACTION READ ONLY e SELECT 1 FROM DUAL, com rollback, timeout de conexão de 5 segundos, sem retentativas e limite de chamada configurável (1–120 segundos). Não consulta pacientes, não importa agendamentos nem dispara notificações. Erros do driver não são devolvidos ao cliente porque podem conter dados da conexão.

O modo Thin/Thick e o diretório do Instant Client continuam sendo configurações do servidor: a biblioteca Oracle define o modo para o processo inteiro. A tela mostra o modo ativo. Os conectores de agendamentos e pós-cirúrgico usam o cadastro por unidade; views e regras continuam dependendo de suas configurações verificadas separadas.

A configuração Oracle deve ser realizada diretamente na instância de origem, com sessão de administrador; chaves de federação não delegam acesso ao cofre nem recebem a senha do administrador pelo proxy.

## API

- GET /api/v1/oracle-configuration/?unit=slug: estado e `persistent_access`; host/usuário apenas enquanto ativo; nunca senhas. `unlocked_until=null` no acesso contínuo.
- POST configure/: version, host, port, identifier_type (service/sid), identifier, username, password, timeout_ms, admin_password.
- POST unlock/: version, admin_password.
- POST lock/ e test/: version.

Use HTTPS ao disponibilizar o painel fora do desenvolvimento local. Backups devem preservar ciphertext, chave encapsulada e salt, além de `ORACLE_CREDENTIALS_KEY` entre os segredos de implantação, separadamente do dump. Não substitua essa chave por uma aleatória ao restaurar. A configuração Oracle não altera o modo ou as permissões de envio WhatsApp.
