# WhatsApp dos relatórios

Container `baileys`, porta 9322 apenas na rede Docker, sem publicação no host. Sessões separadas por unidade. Na tela Relatórios → WhatsApp · QR Code, use Conectar e leia o QR no WhatsApp. Conectar não habilita respostas nem envios.

## Estado inicial

O ambiente permite habilitar o canal com `REPORT_BAILEYS_ALLOW_SENDS=1`. Em Relatórios → WhatsApp · QR Code → Configurar, os controles de Envios, Solicitações por mensagem e Programações são independentes e começam desativados por unidade. Conectar ou habilitar envios não ativa programações.

Para atendimento manual, habilite Envios e Solicitações por mensagem na unidade. Para execução automática, é necessário habilitar também Programações e ativar explicitamente cada programação desejada. As programações existentes permanecem pausadas até essa ação manual. As regras de lembrete e a Meta não são alteradas.

O padrão de novas instalações é `REPORT_BAILEYS_ALLOW_SENDS=0`; para disponibilizar os controles, definir 1 na API, worker, scheduler e Baileys e recriar esses serviços. Os testes mantêm o bloqueio global e não enviam mensagens reais.

## Permissões e conversa

O número precisa existir como destinatário ativo e verificado, sem cadastro de contato ambíguo. Cada relatório requer permissão manual ativa, definição ativa/revisada e origem pronta. Havendo usuário vinculado, ele precisa estar ativo e conservar acesso à seção na unidade.

Relatórios operacionais internos também usam a permissão explícita do destinatário verificado, sem exigir uma conta do painel. A geração reaproveita os mesmos filtros e limites por unidade; revogação de permissão bloqueia geração e entrega.

Cada contato vê apenas os relatórios que pode solicitar. A lista usa números; a palavra-chave exata de um relatório autorizado também pode ser usada após abrir o menu. MENU reinicia; CANCELAR retorna ao menu. A seleção envia a mensagem inicial do relatório e pergunta os parâmetros em sequência. A ordem explícita e dependências de datas não dependem da ordem das chaves JSON no PostgreSQL. Datas usam DD/MM/AAAA e são convertidas para ISO para o mecanismo de consultas. PULAR permite omitir parâmetros opcionais. Restrições fixadas na permissão prevalecem sobre as respostas.

Os campos `prompt`, `order` e `not_before` pertencem à especificação de cada parâmetro; `request_message` pertence ao relatório. `not_before` referencia outro parâmetro de data. Dependências circulares são recusadas. Conversas expiram em 30 minutos. Mensagens antigas ou anteriores ao último evento não avançam o fluxo. O mesmo evento repetido devolve a mesma resposta sem nova execução.

Grupos exigem destinatário de tipo grupo com identificador @g.us e permissão explícita; nunca inferir acesso de grupo a partir do telefone de um membro. O diálogo de um grupo é compartilhado naquele grupo.

## Geração e entrega

O mecanismo de relatórios existente continua gerando PDF, CSV ou texto, com snapshot de versão e parâmetros. As programações usam o canal Baileys quando habilitadas. Downloads pelo painel continuam disponíveis nas permissões existentes; gerar pelo painel não entrega automaticamente pelo Baileys.

As permissões e versões de relatório, conexão, destinatário e concessão são conferidas de novo antes de entregar. Aceitação pelo Baileys aparece como Enviado pelo WhatsApp; não equivale a entrega ou leitura. Falhas com resultado incerto não são reenviadas automaticamente. Mensagens da Meta e lembretes não passam por este serviço.

## Sessão, segurança e operação

O estado de autenticação e a fila de entrada são persistidos em SQLite no volume `orbita_baileys_sessions`, criptografados com AES-256-GCM e AAD por unidade/chave. Não é usado useMultiFileAuthState. `REPORT_BAILEYS_AUTH_KEY` e `REPORT_BAILEYS_TOKEN` são segredos distintos no .env, fora do Git. Os endpoints internos e callback exigem o token. QR e status no painel são somente para administradores da unidade e usam Cache-Control no-store. Logs guardam eventos técnicos sem corpos de mensagens, QR, credenciais ou conteúdo de relatórios.

Backup: com o container Baileys parado, copiar o volume inteiro e preservar a chave de criptografia separadamente. Restaurar o volume com a mesma chave, com envios bloqueados; iniciar o container e conferir status antes de liberar operação. Não copiar uma sessão para duas instâncias ativas.

## Validação

Testes exercitam permissões por unidade/número, datas e períodos, ordem, revogação, expiração, duplicação/concorrência em PostgreSQL e bloqueios. Testes Node usam estado temporário, sem pareamento nem chamadas de envio reais.


## Fluxo com lista nativa

Na aba WhatsApp · QR Code, o botão Fluxo abre um modal para editar mensagem inicial, título, texto do botão e seção da lista. O modal usa controle de versão e não altera a política de envios.

O contato recebe a mensagem inicial e o botão Ver relatórios, que abre a seleção nativa no WhatsApp. A lista contém somente relatórios finais habilitados, revisados e permitidos ao destinatário ativo/verificado. São oito relatórios por página e até duas ações de navegação; a seleção usa IDs opacos vinculados à conversa. Números digitados não selecionam relatórios. Palavras-chave existentes continuam compatíveis. MENU ou CANCELAR reinicia o fluxo.

A escolha segue para a mensagem própria do relatório e os parâmetros configurados, valida os valores e solicita a geração. Permissões e versões são revalidadas na escolha, na geração e na entrega. Menus antigos não selecionam um novo relatório inadvertidamente. Contatos não autorizados recebem resposta genérica.

O transporte usa ListMessage nativo do protocolo do WhatsApp Web com Baileys 7.0.0-rc14. Recebe respostas de listas, botões e native flow. Não depende de links externos nem formulário web. A renderização efetiva no aplicativo do contato precisa de homologação em aparelhos autorizados; aceite do protocolo não garante exibição em todas as versões do WhatsApp. Sem fallback automático para mensagens numeradas e sem repetição de envio incerto.


## Correções de 24/10/2026 — listas e Execuções

O envio ListMessage passou a incluir a estrutura biz/list na retransmissão do protocolo. Aceitação é registrada como list_accepted; recebimentos e leituras têm eventos próprios, sem conteúdo das mensagens. Aceitação não confirma renderização no aplicativo. Não há reenvio automático das listas antigas. Validação em aparelho depende de nova mensagem do contato autorizado.

A tela Execuções reutilizava temporariamente linhas de outra aba e gerava RangeError: Invalid time value ao formatar created_at ausente. A listagem agora usa escopo de unidade/aba e o formatador tolera datas inválidas. Falha reproduzida no navegador antes da publicação; transição Relatórios → Execuções validada depois, com quatro execuções e sem recarregar a página.

Verificação: build frontend, quatro testes de formatação e oito testes Baileys aprovados, sem disparo manual de mensagem real. Logs: /opt/backups/orbita/whatsapp-executions-build.log e /opt/backups/orbita/whatsapp-lists-fix-tests.log.


## Datas, resultados vazios e ações após envio — 24/10/2026

As chaves técnicas start/start_date e end/end_date são apresentadas como Data inicial e Data final no painel e nos prompts do WhatsApp, preservando binds SQL e compatibilidade. Mensagens específicas do relatório continuam disponíveis.

Execuções solicitadas pelo Baileys que retornem zero registros são marcadas no_data, sem arquivo para envio ou download. O contato recebe Não existem dados para a data selecionada e os dois botões nativos. A verificação é por registros retornados, não pelo tamanho do PDF. Valores numéricos zero dentro de um resultado não são apagados como se fossem ausência de dados.

Após envio aceito do documento manual, a aplicação envia uma mensagem de botões quick_reply: Solicitar novamente inicia novamente as perguntas de parâmetros do mesmo relatório; Novo relatório abre a lista com as permissões atuais do contato. Parâmetros restritivos da permissão são mantidos. Opções são vinculadas à execução e têm autorização revalidada na ação e na transmissão.

Sem confirmação de envio do documento, não há mensagem alegando que ele foi enviado. A mensagem de ações possui chave idempotente própria, estado auditado em feedback_state e não é repetida automaticamente se o resultado de transporte for incerto. A proteção contra arquivo vazio vale também para novas execuções automáticas pelo transporte Baileys; ações interativas de continuidade são emitidas para solicitações manuais originadas no WhatsApp.

Testes: 82 testes backend aprovados, incluindo retorno vazio, entrega sem duplicação, repetição com datas limpas, autorização dos botões e consulta sem linhas. Nove testes Baileys aprovados, incluindo construção e validação do payload quick_reply. Build frontend aprovado. Nenhuma mensagem real foi disparada para testar estas alterações.


## Datas com Hoje e Ontem — 24/10/2026

Toda pergunta de parâmetro do tipo date no WhatsApp apresenta DD/MM/AAAA e dois botões nativos: Hoje e Ontem. Datas digitadas continuam aceitas estritamente nesse formato, com conversão interna para ISO para os binds SQL. Prompts personalizados com formato ISO recebem normalização na apresentação. Datas opcionais também exibem os botões e permitem PULAR ou conteúdo vazio para manter o valor padrão/None conforme o cadastro.

Atalhos são identificadores opacos e específicos da pergunta atual. O cálculo usa a data do clique no fuso IANA da unidade; na unidade SCV é America/Sao_Paulo. Botões de perguntas antigas não preenchem o próximo parâmetro. Respostas inválidas e intervalos com fim anterior ao início reapresentam os dois botões. As restrições de parâmetros da permissão continuam prevalecendo.

Validação: 84 testes de regressão aprovados na primeira execução, com um teste adicional de fuso corrigido para fixar o relógio durante toda a conversa. Os três testes de fuso, botão antigo/intervalo e data opcional foram reexecutados e aprovados. Dez testes de transporte Baileys aprovados. Nenhuma mensagem real enviada manualmente durante os testes. A renderização dos botões no aparelho permanece sujeita à conferência pelo destinatário.


## Ajustes de apresentação e Indicadores Médicos — 24/10/2026

Prompts não exibem orientação de PULAR, opcional ou Em branco: hoje. A ausência de obrigatoriedade continua no contrato técnico para compatibilidade, sem induzir o contato a ignorar a pergunta. A especificação de data é enviada como *DD/MM/AAAA* para negrito nativo no WhatsApp; Hoje e Ontem continuam presentes.

Indicadores Médicos: removida a restrição histórica panel_only para origem whatsapp com destinatário existente. As permissões, verificação do número, revisão, canal e dados Oracle de homologação continuam sendo exigidos. Origem automática permanece explicitamente bloqueada. O relatório continua aceitando geração de painel sem destinatário.

A lista não repete o nome inteiro na descrição do mesmo item. Nomes até 24 caracteres aparecem apenas no título; nomes maiores são divididos em título e continuação sem repetir texto. Teste de seleção duplicada, tanto com o mesmo identificador de evento quanto com outro evento, confirmou uma única geração. Nenhum relatório foi mesclado ou excluído.

Regressão: 89 testes backend aprovados, incluindo remoção das instruções antigas, negrito, conteúdo da lista, idempotência e permissão manual dos Indicadores Médicos com bloqueio de programação automática.


## Retornar ao menu — 24/10/2026

As respostas do diálogo que exigiam digitar MENU agora apresentam o botão nativo Retornar ao menu. Nas datas, são três opções: Hoje, Ontem e Retornar ao menu. Erros e indisponibilidade também fornecem o botão, sem instrução textual de digitar MENU. Após entrega ou ausência de dados, as ações são Solicitar novamente e Retornar ao menu.

Retornar ao menu encerra o preenchimento atual e monta novamente a lista de relatórios elegíveis com as permissões atuais. Comandos de texto antigos permanecem compatíveis, mas não são solicitados. Não envia documentos nem reaproveita parâmetros de solicitação anterior. Regressões: 91 testes backend e 11 testes Baileys aprovados. Nenhuma mensagem real enviada manualmente durante a validação.


## Nome dos arquivos — 24/10/2026

Anexos e downloads usam ReportDefinition.name, preservando espaços/acentos, com extensão do formato (PDF, CSV ou TXT). Códigos legacy123-N ficam restritos ao cadastro/rastreabilidade. Separadores de caminho e controles são removidos do nome. Content-Disposition do download usa o helper Django para codificar corretamente UTF-8. O transporte não substitui mais letras acentuadas por underscores. Arquivos já recebidos no WhatsApp não são renomeados retroativamente.

Regressão: 92 testes backend e 12 testes Baileys aprovados. Nenhum disparo real de teste.
