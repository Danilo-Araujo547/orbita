# Diagnóstico do botão de confirmação — 14/10/2026

O envio ao número de teste foi aceito pela Meta, com identificador real. O erro reportado ocorre no botão do WhatsApp, não na confirmação manual do painel.

Flow publicado: `1113114081215929`, template `confirmacao_consulta_sqlite_v1`. A Meta informa estado `PUBLISHED` e nenhuma falha de validação do JSON. O asset foi obtido por leitura da API e sua cópia está em `artifacts/meta-confirmacao-flow.json`.

Dois pontos encontrados:

1. A tela `CONFIRMACAO` usa `${data.medico}`, `${data.exame}` e `${data.error_message}`. O envio original passava somente `flow_token`. O transporte foi corrigido para enviar esses dados iniciais, derivados do agendamento e preservados no snapshot da mensagem. Os envios anteriores não são reenviados automaticamente.
2. O botão **Enviar resposta** executa `data_exchange`. O Flow aponta para `https://sta.tdanilo.com/plataforma/api/hooks/appointment-test`. Consultas GET e OPTIONS retornaram HTTP 404, com ou sem barra final. A saúde do Flow também informa que a disponibilidade/verificação do endpoint precisa ser conferida. É necessário investigar o serviço publicado nesse endereço e seu processamento de requisições criptografadas, persistência e correlação do `flow_token`. Esse serviço não está no repositório local do Órbita.

Corrigir apenas os dados iniciais não garante o registro da confirmação: o serviço de troca de dados precisa estar acessível e reconhecer o identificador gerado pelo Órbita. O callback geral de mensagens WhatsApp é um recurso diferente do endpoint de troca de dados do Flow.

O administrador indicou `metapi.santacasavotuporanga.com.br` como servidor a investigar. DNS público Google e Cloudflare resolveram esse domínio para `179.199.154.87`; o resolvedor local devolveu NXDOMAIN. A verificação HTTPS foi feita com resolução temporária somente no processo de diagnóstico, preservando validação TLS e hostname. A página inicial serve Chatwoot via nginx; `/callback/whatsappapi` responde 403 a GET sem verificação e `/plataforma/api/hooks/appointment-test` responde 404. O endpoint do Flow na Meta não foi trocado: mudar somente o domínio sem implementar/verificar a rota receptora não corrige o processamento. É necessário acesso ao serviço desse servidor.

O acesso SSH existente funcionou e identificou o host `srv2048646`. Inspeção somente de leitura: `/home/apps/meta/app.py` implementa o callback geral, mas não o endpoint Flow; os dois virtual hosts nginx encaminham os demais caminhos para Chatwoot em `100.103.47.41:3000`. O serviço já conhecido em `100.103.47.41:9321` também respondeu 404 ao POST vazio no caminho do Flow. Nenhum arquivo/configuração remoto foi alterado.

A API de criptografia do número informa chave pública presente e assinatura `VALID`. Existem dois Flows publicados e outros rascunhos. Não foi encontrada uma chave privada de Flow na busca por nomes de arquivos em `/home`, `/opt`, `/srv` e `/root` até profundidade 5. Não foi substituída a chave pública do número, pois isso afetaria os demais Flows. Próximo requisito: localizar a chave privada correspondente ou o projeto que a mantém; então implementar e testar a troca criptografada, a persistência e a associação da resposta ao Órbita antes de publicar a rota.

Após o administrador informar que não possui a chave privada, foi adotado um novo Flow com ação terminal `complete`, sem endpoint de troca de dados. O novo formulário e a integração de recebimento estão descritos em [Confirmação v2](WHATSAPP_FLOW_V2.md). O template foi submetido à Meta; novos disparos permanecem pausados enquanto estiver em análise. A chave existente e o serviço remoto não foram alterados.
