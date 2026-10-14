# Instâncias remotas do Órbita

## Uso

1. Instale esta versão do Órbita nas duas máquinas. Cada instalação precisa de um
   `ORBITA_INSTANCE_ID` próprio (UUID estável) e uma `INSTANCE_CREDENTIALS_KEY` Fernet
   privada. `Start-Local.ps1` provisiona automaticamente os parâmetros ausentes;
   parâmetros explicitamente vazios devem ser preenchidos pelo administrador.
2. Na **origem**, selecione a unidade e abra **Configurações → Instâncias remotas →
   Gerar chave**. Defina identificação, permissão e validade (1–365 dias). A chave
   aparece uma única vez. Copie-a para a instalação que irá acessar esta unidade.
3. No **painel central**, selecione a unidade local cujos membros terão acesso à
   conexão. Em **Conectar instância**, informe identificação, URL base que publica
   a API e a chave emitida na origem. Exemplo: `https://orbita.hospital.exemplo` ou
   `http://192.168.20.10:5173` em rede privada com o proxy Vite local ativo.
4. Após a validação, a unidade de origem aparece no seletor com ícone de nuvem,
   nome da conexão e indicação **Remota**. Selecione-a para consultar ou operar.

Uma chave autoriza **uma unidade**. Para acessar várias unidades da mesma
instalação, gere uma chave por unidade e cadastre as conexões correspondentes.
A mesma unidade remota não pode ser cadastrada duas vezes sob a mesma unidade local.
Uma conexão existente não pode mudar de instalação ou unidade de origem: crie uma
nova conexão para outro destino, preservando o espaço de IDs de cada origem.
A conexão fica disponível aos membros da unidade local que a administra; o perfil
efetivo é o menor entre perfil local, concessão da chave e permissão atual do emissor.

## Dados e execução

No banco central são persistidos apenas identificação/URL da conexão, chave
cifrada, identificação da instalação remota, metadados da unidade, permissões e
resultado/data da verificação. **Não é criada uma Unit local para a unidade remota.**
O identificador `remote:<UUID da conexão>` distingue os espaços de trabalho e seus IDs.

Agendamentos, pacientes, grupos, mensagens, respostas, observações, importações,
relatórios e tarefas são consultados/alterados **na origem**. Não são replicados,
armazenados em recibos locais ou escritos em arquivos locais pelo encaminhador.
Exportações e arquivos são transmitidos diretamente para a resposta de download
(buffer limitado), sem cópia em disco. Respostas têm `Cache-Control: no-store`.
O navegador mantém apenas o estado necessário para exibir a tela atual.

Uma instância indisponível retorna erro explícito. Não há fallback para dados locais,
sincronização posterior ou fila local de ações remotas. As chaves e conexões não
podem ser administradas por outra chave: não há encadeamento de instâncias.
Administração de usuários/unidades e criação de dados de teste são feitas na origem.
Configuração Meta, atendimento, grupos e demais recursos operacionais continuam
usando os contratos existentes e verificam a unidade na origem.

O envio real de WhatsApp **continua bloqueado**, inclusive no transporte. A conexão
não libera envio, não agenda notificações automaticamente e aceita somente pares
compatíveis que declarem o bloqueio no manifesto.

## Segurança e revogação

- A chave emitida contém 256 bits aleatórios; a origem persiste somente SHA-256,
  com comparação em tempo constante. Listagens e auditoria não recuperam o segredo.
- A central cifra a chave com uma chave Fernet própria, diferente da chave da Meta.
  Faça backup protegido do ambiente/chaves separadamente do banco. Não copie a
  identidade de uma instalação para outra; preserve-a somente em restaurações da
  mesma instalação.
- O navegador nunca recebe a chave salva da conexão. A comunicação ocorre entre
  os backends, com `Authorization: Bearer ...`, sem encaminhar cookies ou sessão local.
- A chave é verificada a cada requisição: revogação, validade, usuário ativo e
  vínculo/permissão atual do emissor. Remover acesso do emissor reduz/interrompe o
  acesso delegado. Recomenda-se um usuário de integração dedicado na origem.
- **Revogar** na origem impede novas requisições imediatamente; chamadas já em
  andamento podem terminar. **Desconectar** na central oculta a unidade do seletor
  e recusa novos acessos por aquela conexão, preservando seu cadastro/auditoria.
- **Verificar** atualiza identidade, metadados, permissão e situação. A situação
  “Validada” refere-se à última verificação, não a uma garantia de disponibilidade
  contínua. Editar e validar novamente pode reativar uma conexão desconectada.
- Alterar a URL exige informar novamente a chave, para não encaminhar a credencial
  salva inadvertidamente a outro servidor. URLs não aceitam usuário/senha, query,
  fragmento ou travessia de caminho. HTTP público é recusado; HTTPS valida o
  certificado. HTTP privado requer uma rede confiável ou VPN.
- DNS é validado e o endereço de conexão é fixado por requisição. Endereços
  link-local, multicast, não especificados e reservados são recusados. Redirecionamentos
  não são seguidos. O cliente ignora proxies do ambiente e usa timeouts/limites de tamanho.
- O encaminhador exige sessão local e CSRF nas alterações. Permissões locais são
  enviadas como um teto, nunca como ampliação da concessão remota. Na origem, cada
  evento de auditoria criado por uma chave registra `instance_access_key`.

## APIs

API da origem, autenticada por chave:

- `GET /api/v1/federation/manifest/`: protocolo `orbita-federation/1`, identidade,
  unidade autorizada, perfil efetivo e bloqueio de envio.
- APIs operacionais existentes em `/api/v1/`, restritas à unidade da chave.
  O parâmetro `unit` pode ser omitido; informar outra unidade retorna `403`.
  APIs de autenticação, usuários, unidades, emissão de chaves, conexões e relay
  não estão disponíveis por chave.

Administração autenticada por sessão local, restrita a administradores da unidade:

- `GET/POST /api/v1/instance-keys/?unit=ame`: listar/emitir chaves. POST recebe
  `name`, `role` (`viewer`, `operator`, `admin`) e `validity_days` (padrão 90).
- `POST /api/v1/instance-keys/{id}/revoke/?unit=ame`.
- `GET/POST /api/v1/remote-instances/?unit=ame`: listar/conectar. POST recebe
  `version: 0`, `name`, `base_url`, `key`; valida antes de salvar.
- `POST /api/v1/remote-instances/{id}/configure/?unit=ame`: editar; versão atual,
  nome, URL, chave opcional quando a URL não muda.
- `POST /api/v1/remote-instances/{id}/check/?unit=ame`: verificar, com versão atual.
- `POST /api/v1/remote-instances/{id}/disconnect/?unit=ame`: desconectar, com versão.
- `GET/POST /api/v1/remote/{connection_id}/{recurso}/`: encaminhar recurso autorizado.
  A unidade da query é sempre substituída pela unidade vinculada à conexão. Recursos,
  filtros, corpos e resultados seguem a API operacional da origem. Downloads CSV/PDF
  e paginação são encaminhados; URLs de paginação retornam pelo relay local.
- `GET /api/v1/auth/session/` inclui opções remotas e papéis efetivos sem segredos.

Todos os POSTs de administração e ações remotas exigem `Idempotency-Key` (8–100
caracteres). O relay preserva a chave da ação para a origem e não grava o corpo ou
resultado em recibos locais. A emissão de chave não armazena a resposta secreta:
repetir sua chave de idempotência retorna `409`, sem emitir outra chave. Se perder
o segredo, revogue a anterior e gere outra. Alterações concorrentes de conexão
também retornam `409` em vez de sobrescrever uma versão posterior.

Timeout/falha de rede após uma alteração gera **resultado incerto**. Não há repetição
automática. Confira a origem; para repetir por API, use a mesma chave de idempotência.
Endpoints legados sem recibo devem ser reconciliados antes de repetir (por exemplo,
o controle de pausa). A central não promete execução exatamente uma vez nesses casos.

## Validação realizada

Testes cobrem emissão sem persistir segredo, revogação, expiração, permissões do
emissor, teto local, isolamento entre unidades, CSRF, ausência de replicação,
encaminhamento de idempotência, respostas incertas, indisponibilidade, URLs e alvos
proibidos, downloads e navegação. Um teste de integração realiza handshake e consulta
por HTTP real contra uma origem de teste em porta efêmera; APIs da origem são
testadas com autenticação por chave. Nenhum servidor externo foi cadastrado
automaticamente e não foram emitidas chaves operacionais durante a implementação.
