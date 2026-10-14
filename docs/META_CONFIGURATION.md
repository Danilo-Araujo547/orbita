# Meta por unidade — somente validação

Em **Configurações**, um administrador da unidade cadastra WABA ID, Phone Number ID,
Business ID, App ID, versão da Graph API e token de acesso. Business ID e App ID são
informativos e opcionais; não são certificados pela validação atual. App Secret e
token de verificação são opcionais e ficam reservados para a evolução do webhook.
O webhook legado continua separado: salvar esses campos não ativa nem reconfigura
o recebimento.

## Proteção e permissões

- Apenas administradores da própria unidade acessam ou alteram a configuração.
- Tokens e App Secret são cifrados com Fernet antes de persistir no PostgreSQL.
- As APIs retornam apenas indicadores de credencial cadastrada, nunca o segredo
  nem o conteúdo cifrado. Campos vazios preservam a credencial; a remoção é explícita.
- Auditoria registra operação, versão e resultado, sem credenciais ou erros brutos
  do provedor. Recibos de idempotência guardam somente hash da entrada e saída segura.
- Alterações exigem versão atual e `Idempotency-Key`; conflitos retornam `409`.
- A chave `META_CREDENTIALS_KEY` é independente de `DJANGO_SECRET_KEY`, fica no
  ambiente privado e deve ser preservada em backup protegido separado do banco.
  Perder/trocar a chave sem recifrar os dados impede a leitura dos segredos existentes.
  O ambiente local já possui a chave; outros ambientes precisam provisionar uma
  chave Fernet válida antes de cadastrar segredos.

## Validação

O botão **Validar e consultar templates** realiza exclusivamente GETs na Graph API:

1. `/{waba_id}?fields=id,name`;
2. `/{waba_id}/phone_numbers`, verificando que o Phone Number ID pertence à WABA;
3. `/{waba_id}/message_templates`, consultando ID, nome, idioma, categoria, estado
   e componentes.

O token precisa ter acesso ao ativo e permissão `whatsapp_business_management`.
Não há promessa de prazo de validade do token: a checagem comprova o acesso apenas
no momento da consulta. A versão da API é configurável; o padrão existente é v24.0.

O catálogo consultado é independente dos templates operacionais. A tela confere
aprovação na Meta, correspondência por nome/idioma, texto e quantidade/sequência
das variáveis do corpo. O significado e a ordem do mapeamento local, parâmetros
nomeados, cabeçalhos e botões exigem revisão humana. Não importa automaticamente
templates para regras nem altera `approved_for_test`.

Paginação usa cursores no host fixo da Meta; URLs `next` nunca são seguidas.
Consultas têm timeouts, limite de páginas e até 1.000 registros por coleção.
Falhas não aplicam um catálogo parcial. A última consulta bem-sucedida permanece
disponível com data e aviso de possível desatualização. Alterar a configuração
invalida a validação e limpa o catálogo anterior. Exemplos de variáveis fornecidos
pela Meta não são armazenados.

Referência: [coleção oficial da Meta — consultar templates](https://www.postman.com/meta/whatsapp-business-platform/request/qtgr0i7/get-all-templates-default-fields).

## Envio permanece bloqueado

`MetaTransport.send` recusa incondicionalmente com `meta_sending_disabled`, antes
de qualquer rede ou upload de relatório. O despachante também bloqueia modos
diferentes de `simulated` antes de criar tentativas. Não existe opção nesta tela
para habilitar envio real. Salvar credenciais, validar, aprovar um template local,
despausar uma unidade ou definir `SEND_MODE=meta_test` não remove esses bloqueios.
O modo simulado continua local, sem comunicação com destinatários.

## API

- `GET /api/v1/meta-configuration/?unit=ame`: configuração segura; versão 0 indica
  unidade ainda sem cadastro (a leitura não cria dados).
- `POST /api/v1/meta-configuration/configure/?unit=ame`: versão e campos; segredos
  somente na escrita. `clear_secrets` aceita `access_token`, `app_secret`, `verify_token`.
- `POST /api/v1/meta-configuration/validate/?unit=ame`: versão atual; validação e
  sincronização do catálogo. A operação é POST local para registrar o resultado,
  mas usa somente GET na Meta.

Ambos os POSTs exigem `Idempotency-Key`. A validação também incrementa a versão.
O OpenAPI descreve contratos de entrada e saída. Nenhuma credencial real foi
preenchida automaticamente; testes de integração usam respostas simuladas da Meta.
