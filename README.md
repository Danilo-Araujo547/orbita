# Órbita — Orbita

Conexões por URL e chave, sem replicação de registros: veja
[o guia de instâncias remotas](docs/REMOTE_INSTANCES.md).

## Evolução operacional — 13/10/2026

O painel inclui Agendamentos operacionais, Correções, histórico da equipe, múltiplos contatos, campanhas, importação CROSS, movimentações acompanhadas, preparos versionados e relatórios operacionais. Não há atribuição de pacientes a operadores. Mantidos o visual azul/ciano e os temas claro/escuro/sistema.

Consulte [o estado da implementação e as homologações pendentes](docs/EVOLUTION_STATUS.md) e [o guia de operação](docs/OPERATIONS_GUIDE.md). A entrega local não libera envio real, não substitui o ROB8 e não significa que o piloto de sete dias tenha sido cumprido.

O banco local agora é PostgreSQL 18 em `127.0.0.1:5432`, banco `orbita`. O SQLite anterior é apenas uma cópia histórica. Faça backup com `pg_dump` antes de atualizações; migração e restauração foram verificadas em cópias privadas. O script de inicialização aplica as migrações e inicializa o catálogo operacional sem importar o histórico legado.

Primeira versão modular dos lembretes da AME Votuporanga: consultas, exames e laboratório, fila, respostas, pendências e painel de indicadores. O nome Órbita é a identidade provisória do novo painel.

## Estado desta entrega

- Painel React funcional, API Django, banco próprio e processamento Celery/Redis preparado para Docker.
- Regras ativas documentadas da AME cadastradas; integração direta com Oracle 11.2.0.4 validada em modo Thick.
- Envio pela Meta implementado, mas **a validação externa depende das credenciais e dos templates do canal separado de teste**.
- O modo padrão é `simulated`: nenhuma chamada de envio ao WhatsApp. A unidade começa pausada e o template começa sem validação local.
- Registros reais nunca podem ser enviados nesta versão, mesmo por ação individual. A importação gera análise ou pendência, sem transformar pacientes em destinatários de teste.
- A execução local e o Compose usam PostgreSQL. O ambiente Windows inicia seu cluster local com `scripts/Start-Postgres.ps1`; os testes de concorrência executam nesse PostgreSQL.

## Abrir localmente no Windows

Requisitos: Python 3.12, Node 24 ou posterior e PostgreSQL. Nesta máquina, o cluster e o `.env` já estão configurados. Na pasta do projeto:

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm.cmd ci --prefix frontend
& .\scripts\Start-Local.ps1
```

Painel: **http://127.0.0.1:5173**. Usuário inicial: `admin`.

O painel local escuta em `0.0.0.0:5173`, permitindo acesso por `http://IP-DESTA-MAQUINA:5173` na rede. O script imprime os endereços disponíveis e configura suas origens para autenticação com CSRF. A API permanece em loopback e é acessada pelo proxy do painel. Depois de trocar de rede, reinicie o script para atualizar os endereços. O firewall da máquina precisa permitir a porta 5173 para o perfil de rede utilizado.

Na primeira execução, o script gera uma senha aleatória em `BOOTSTRAP_PASSWORD` no arquivo local `.env`, ignorado pelo Git. Não existe senha padrão compartilhada. O arquivo também contém a chave da sessão; mantenha-o privado. Alterar `BOOTSTRAP_PASSWORD` não altera a senha de um usuário já criado: use `backend/manage.py changepassword admin` nesse caso.

```powershell
# Parar somente os processos registrados deste projeto:
& .\scripts\Stop-Local.ps1

# Executar um ciclo manual do agendador/fila no ambiente local:
& .\scripts\Run-Tick.ps1
```

No modo local, o painel e a API ficam ativos; o agendador não roda continuamente. No Docker, worker e agendador rodam automaticamente. O arquivo `artifacts/runtime.json` registra os processos locais. Os exemplos criados por `-Demo` são fictícios; nenhuma integração externa é chamada pelo gerador.

## Validar um lembrete completo

1. Confirme `SEND_MODE=simulated` no `.env` e inclua somente números autorizados em `TEST_RECIPIENTS`, em formato internacional, separados por vírgula. Reinicie os processos depois de alterar o ambiente.
2. Em **Configurações → Templates**, confira o mapa e marque o template como validado para testes. No modo simulado, isso habilita apenas o transporte simulado.
3. Em **Configurações**, habilite os testes.
4. Clique em **Novo teste**. Escolha o número autorizado e o tipo. A aplicação cria um paciente e um agendamento fictícios.
5. Em **Mensagens**, abra o registro e clique em **Processar envio de teste**.
6. No detalhe da mensagem, simule entrega, leitura, confirmação, recusa ou resposta livre. Confira o resultado em **Respostas**, **Pendências** e **Visão geral**.
7. Ao terminar, pause os envios. Os testes desta implementação terminaram pausados, com o template sem validação local.

O guia da equipe está em `/guia.html`. Administradores configuram regras e templates; operadores resolvem pendências e fazem testes individuais; o perfil de consulta não pode alterar nem enviar.

## Oracle: leitura e compatibilidade

A AME usa Oracle **11.2.0.4**, que exigiu `python-oracledb` em modo **Thick**, com Instant Client 19.32. O cliente foi obtido da [Oracle](https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html), com SHA256 conferido. O Dockerfile inclui o cliente Linux correspondente, também com checksum.

```powershell
& .\scripts\Install-OracleClient.ps1
```

Configure `ORACLE_DSN`, `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_THICK=1` e `ORACLE_CLIENT_DIR`. Prefira uma conta dedicada com SELECT apenas nas três views e no log legado. Toda conexão do conector inicia `SET TRANSACTION READ ONLY` e termina em rollback.

Para a máquina desta investigação, o script também aceita a credencial DPAPI já existente, sem copiá-la para `.env`:

```powershell
& .\scripts\Start-Local.ps1 -OracleCredentialPath "$env:LOCALAPPDATA\Temp\rob8-ame-oracle.xml"
```

Essa opção carrega a senha apenas no ambiente do processo da API. O arquivo DPAPI só pode ser aberto pela conta Windows que o criou. Não há senha Oracle no código ou nos relatórios. Ao usar `Run-Tick.ps1`, configure a credencial no ambiente do processo de tarefas; ele não herda a opção passada a outra execução de `Start-Local.ps1`.

Com o ambiente Oracle configurado:

```powershell
& .\.venv\Scripts\python.exe backend/manage.py check_oracle
& .\.venv\Scripts\python.exe backend/manage.py validate_oracle_import --rule consultation-d7
```

`check_oracle` verifica campos sem consultar pacientes. `validate_oracle_import` consulta os agendamentos, exercita a importação e desfaz **todas as mudanças locais dessa validação**. Imprime somente contagens e códigos seguros. A importação normal pelo painel persiste os registros localmente para análise; não escreve no hospitalar.

O timeout padrão é 120 segundos por chamada Oracle, configurável por `ORACLE_CALL_TIMEOUT_MS`. As views de consultas e exames excederam 30 segundos na primeira validação. No Docker, a importação manual é enfileirada e retorna HTTP 202; localmente ela roda na própria requisição.

As views podem repetir um agendamento para contatos diferentes. Linhas idênticas são consolidadas. Todos os contatos distintos são preservados e recebem entregas separadas da mesma notificação, sem duplicar paciente/agendamento. Dados clínicos conflitantes continuam exigindo revisão. A ausência de uma linha numa consulta filtrada **não é tratada como cancelamento**.

## Canal separado da Meta

Não reutilize nem altere o webhook do robô em operação para testar esta aplicação. Configure um número/app separado e:

```dotenv
SEND_MODE=meta_test
META_UNIT_SLUG=ame
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=
META_API_VERSION=v24.0
TEST_RECIPIENTS=
```

Cadastre no painel o nome e o idioma de um template aprovado nesse canal, com os parâmetros na ordem correta. O texto inicial é uma referência de demonstração, não uma cópia comprovada do template remoto. Salvar conteúdo ou mapa desmarca a validação local e invalida mensagens pendentes; confira o template antes de habilitar novamente. O payload atual suporta parâmetros de texto no corpo, suficientes para os lembretes deste escopo; cabeçalhos de mídia e botões dinâmicos ficam para extensão do transporte.

Exponha somente `/webhooks/whatsapp/` por endereço HTTPS público, mantendo painel, API e bancos privados. Configure o domínio em `ALLOWED_HOSTS`. O GET valida o token; o POST exige assinatura `X-Hub-Signature-256`. O número do canal também é verificado. A referência oficial da Meta está na [documentação de webhooks](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference).

Aceitação pela API, envio, entrega e leitura são estados distintos. Eventos repetidos são deduplicados e eventos atrasados não rebaixam uma leitura para envio. Resultados de rede incertos e workers interrompidos ficam para revisão e **não têm reenvio automático**. Não há promessa de entrega exatamente uma vez por um provedor externo.

## Docker Compose

Instale Docker Desktop com contêineres Linux. Copie `.env.example` para `.env` e defina chaves e senhas fortes. Para Oracle no Docker, deixe `ORACLE_CLIENT_DIR` vazio: o cliente é encontrado pela configuração de bibliotecas da imagem Linux. Não use um caminho `C:\...` dentro do contêiner.

```powershell
docker compose up --build -d
docker compose exec api python manage.py seed_demo
# Painel: http://127.0.0.1:8080
docker compose --profile test run --rm tests
docker compose logs --tail=100 api worker scheduler
docker compose stop
```

Somente o painel é publicado, ligado a `127.0.0.1`. PostgreSQL e Redis ficam na rede interna. Volumes preservam os dados entre reinicializações. `bootstrap` é idempotente e não sobrescreve regras, senhas ou a pausa de uma unidade existente. Faça backup do PostgreSQL antes de futuras atualizações; para recuperação, restaure o banco e volte a subir os serviços com envios pausados. Mensagens em resultado incerto exigem revisão antes de qualquer decisão operacional.

## Organização e extensão

| Módulo | Responsabilidade |
|---|---|
| `core` | Unidades, perfis, auditoria, autenticação, API e contratos |
| `scheduling` | Agendamentos normalizados, conector Oracle, importações e regras versionadas |
| `messaging` | Templates, fila persistente, tentativas e transportes substituíveis |
| `responses` | Eventos, respostas, associação ao lembrete e pendências |
| `frontend/src/components` | Componentes visuais reutilizáveis e formulários de operação |

O PostgreSQL é a fonte definitiva da fila; Celery/Redis apenas executam e acionam suas tarefas. O conector entrega `AppointmentData`, sem expor SQL às regras. Relatórios futuros poderão implementar outro produtor de mensagens; outros canais poderão implementar `Transport`. Os registros já possuem unidade, mas a configuração externa de Oracle/Meta desta primeira versão atende uma unidade por ambiente. A entrada de outra unidade exige um registro de conectores/canais por unidade, sem mudar o núcleo de fila e respostas.

As respostas ficam no banco próprio. A aplicação **não confirma nem cancela agendamentos no hospitalar**. Pós-cirúrgico, busca ativa, relatórios sob demanda e atendimento humano não estão implementados nesta entrega.

## Django Admin

Administração em `http://localhost:8000/admin/`. O usuário local `admin` utiliza a mesma senha do painel e precisa de `is_staff` e `is_superuser`. Não há senha padrão. Os modelos do Órbita são restritos ao superusuário: configurações podem ser administradas; agendamentos, mensagens, respostas e histórico são somente leitura. Operadores continuam usando o painel e suas permissões por unidade.

## Verificação

```powershell
& .\scripts\Test-Backend.ps1
& .\.venv\Scripts\python.exe -m ruff check backend
& .\.venv\Scripts\python.exe backend/manage.py makemigrations --check --dry-run
& .\.venv\Scripts\python.exe backend/manage.py spectacular --file docs/openapi.yaml --validate --fail-on-warn
npm.cmd run test --prefix frontend
npm.cmd run build --prefix frontend
npm.cmd audit --prefix frontend
```

API autenticada em `/api/v1/`, schema em `/api/v1/schema/`, Swagger em `/api/v1/docs/`. O schema exportado está em `docs/openapi.yaml`; a documentação do legado, em `docs/LEGACY_RULES.md`; os resultados e limitações desta validação, em `docs/VALIDATION.md`.
# Configuração da Meta por unidade

O painel de Configurações permite cadastrar credenciais protegidas, validar a
WABA e o número e consultar o catálogo de templates. O envio real permanece
bloqueado no backend, inclusive em `meta_test`. Consulte
[o guia de configuração e validação](docs/META_CONFIGURATION.md).

