# Evolução operacional do Órbita

Implementação local em 13/10/2026. O sistema continua em validação, com unidade pausada, dados reais em análise e envio real bloqueado. Este documento distingue código entregue de homologação operacional; sete dias de operação paralela não podem ser considerados cumpridos por testes automatizados.

## Revisão aplicada: agendamentos e múltiplos contatos

Paciente identificado por unidade/sistema/código de origem; agendamento permanece independente. Notification representa a comunicação lógica e Message representa sua entrega por destinatário, com unicidade por notificação e número. O modelo técnico Case foi preservado para compatibilidade e histórico; não representa atribuição do paciente a operador.

Respostas são consolidadas por contato e revisão, com histórico original preservado. Confirmação com silêncio permanece confirmada; confirmação com recusa gera uma única correção. Opt-out e destinatário incorreto não bloqueiam os demais contatos. A ausência de resposta permanece filtro, sem gerar correção automática.

Atualização somente de leitura Oracle dos 375 agendamentos reais já locais recuperou 368 identidades de paciente e 210 agendamentos com múltiplos contatos. Permaneceram 390 agendamentos e 390 mensagens; nenhuma mensagem foi criada pela atualização, nem houve escrita no Oracle. Notificações pendentes da revisão anterior foram invalidadas; permanecem no histórico. A geração de novas prévias é separada da atualização.

`appointments/` acrescenta filtros operacionais e resumo; `appointments/export/` usa os mesmos filtros. `refresh_local_contacts --unit ame` lê apenas identificadores já locais, atualiza numa transação local e não cria mensagens. Colunas opcionais da origem são verificadas por metadados, sem inferir identidade por nome/telefone.

## Implementado

| Área | Entrega |
|---|---|
| Fundação | Eventos de origem, casos por finalidade, contatos, interações, políticas e isolamento por unidade. Migração aditiva dos registros já existentes no Órbita; nenhum histórico externo importado. |
| Agendamentos | Lista operacional por agendamento, contatos e entregas separados, resposta consolidada, observações de 4.000 caracteres, ligações e classificação. Observações registradas em modal sobre a lista. Sem atribuição de pacientes. Correções são intervenções, não cadastro de pacientes. Histórico paginado e controle de versão com HTTP 409. |
| Respostas | SIM/NÃO contextualizados, destinatário incorreto e opt-out separados, conteúdo não textual encaminhado para revisão, preservação da classificação original e decisões manuais em histórico. Respostas de revisão anterior não confirmam uma nova data. |
| Fila | Associação de mensagens a casos, fotografia de regras/templates/parâmetros, bloqueio por contato/caso, condições de resposta, validade e invalidação de notificações pendentes. |
| CROSS | CSV UTF-8 e XLSX, layouts versionados por unidade, prévia paginada, erros por linha, deduplicação e confirmação separada de criação de campanha. Arquivos não causam envio. |
| Campanhas | Rascunho por finalidade, seleção de casos e geração idempotente de mensagens em análise. |
| Pós-cirúrgico | Conector Oracle somente leitura e regras temporais próprias. Resposta negativa destaca atendimento humano. Fontes e regras começam desabilitadas e exigem evidência. |
| Preparos | Cadastro por código, versões preservadas e consulta exata ao preparar template; sem aproximação por nome. A origem atual ainda precisa fornecer código de procedimento homologado para automatizar esse vínculo. |
| Movimentações | Solicitações locais pendentes; confirmação humana com evidência e dados finais; revisão e invalidação das mensagens anteriores; nova comunicação somente em prévia após a confirmação. Nenhuma escrita no hospitalar. |
| Relatórios | Catálogo operacional, PDF/CSV/texto, solicitações, permissões, número verificado, revogação, comandos recebidos e agendamento de geração. Prévia de entrega de PDF e suporte de transporte a documento; envio continua bloqueado. |
| Multiunidade | Cadastro de unidades pausadas, equipe própria, conexão Oracle separada por unidade, fontes e regras independentes. Nenhuma regra AME é copiada automaticamente para nova unidade. |
| Operação | Métricas de casos com denominador explícito, diagnóstico por unidade, tarefas assíncronas com Redis/Celery e ciclo manual local. Backup, migração e restauração testados em cópias SQLite. |

## Homologações e impedimentos ainda abertos

1. **CROSS legado:** não foi comprovada a rotina exata que grava BUSCA ATIVA CDR em TBAVISOS na instalação 172.16.0.123. O novo importador está implementado, mas não há layout real cadastrado como validado. São necessários cabeçalhos e amostra desidentificada por unidade.
2. **Unidades e fontes:** apenas a AME já possuía integração configurada. A plataforma aceita outras unidades, mas suas credenciais, views, contratos de campos e regras precisam ser confirmados individualmente. Não se tratam os três servidores investigados como configurações equivalentes.
3. **Pós-cirúrgico:** existe evidência da origem e de regras no 172.19.0.123. O conector novo não foi habilitado contra pacientes nem teve homologação de resultado real; as configurações não são ativadas por inferência.
4. **Catálogo externo:** reconstruídos os relatórios operacionais. Estoque está visível como indisponível. A definição observada no 172.16.0.124 referencia uma origem diferente, e não estão homologados seu vínculo com cada unidade, contrato de consulta e conta de leitura. Procedures desconhecidas não são executadas. Palavras-chave órfãs não se tornam relatórios válidos.
5. **WhatsApp:** templates `_demo` são referências locais não aprovadas para envio. Canal separado, templates aprovados, cabeçalhos/botões e entrega real de PDFs ainda exigem validação externa. Pedidos recebidos podem gerar relatório e prévia; não significam envio ao solicitante. Não houve alteração do webhook legado.
6. **Homologação PostgreSQL:** Docker/PostgreSQL não estão disponíveis nesta máquina. Os testes de concorrência real foram acrescentados e ficam explicitamente pulados no SQLite. Devem passar no serviço `tests` do Compose antes de produção.
7. **Piloto:** faltam sete dias operacionais comparados, divisão exclusiva de responsabilidade com o legado, limites por grupo, aceite institucional e exercício de reversão operacional. Não há liberação de produção nesta entrega.

## Contratos de API

Preservado `/api/v1/`. Novos recursos: `cases`, `contacts`, `movements`, `preparations`, `layouts`, `policies`, `sheet-imports`, `campaigns`, `reports`, `report-access`, `report-requests`, `report-schedules`, `sources`, `flow-rules`, `flow-runs`, `units` e `members`.

- Novas ações de escrita exigem `Idempotency-Key` de 8–100 caracteres. Repetir chave e conteúdo devolve o resultado anterior; reutilizá-la para conteúdo diferente retorna 409.
- `cases/{id}/act/` recebe versão, ação e justificativa. Ações: note, call e classify. Assign, wait, close e reopen não são aceitas para pacientes. Ligação atendida exige interlocutor.
- `cases/{id}/timeline/`, `communications/`, `cases/metrics/`, `health/` e `export/` respeitam a unidade. A exportação usa os mesmos filtros da lista e limita 10.000 casos.
- Configurações revisáveis usam `configure/` com versão. Preparos recebem nova versão por criação. Layout já utilizado deve ser substituído por uma nova versão.
- `sheet-imports` recebe arquivo codificado em base64, nome e layout; máximo 5 MB, 10.000 linhas e 30 MB expandidos para XLSX. `confirm/` não gera mensagens.
- `campaigns/{id}/preview/` prepara notificações em análise. Não existe botão de liberação real.
- `movements/{id}/confirm/` recebe versão, evidência e dados finais. Datas finais usam ISO 8601 com fuso horário.
- Relatórios revalidam autorização na solicitação, geração, download e transporte. Resultado fica privado no banco, fora da resposta JSON de listagem.
- Comando de relatório: `RELATORIO PALAVRA_CHAVE` ou `RELATORIO PALAVRA_CHAVE AAAA-MM-DD AAAA-MM-DD`; somente número verificado e autorizado. Pedidos por WhatsApp/agendamento geram PDF e prévia de entrega.

OpenAPI disponível em `/api/v1/docs/` para usuário autenticado.

## Infraestrutura e recuperação

`scripts/verify_migration.py` usa o mecanismo de backup SQLite, aplica migrações numa cópia, valida contagens e integridade e restaura outra cópia. Os arquivos ficam em `artifacts/migration-*/`, ignorados pelo Git. A verificação não substitui o banco em uso.

No ambiente PostgreSQL, executar backup/restauração e os testes concorrentes antes do piloto. Arquivos de relatórios estão no banco e acompanham seu backup. O procedimento SQLite não deve ser usado como validação de backup PostgreSQL.

Para outra unidade, configurar `ORACLE_<SLUG_EM_MAIÚSCULAS_COM_UNDERSCORES>_DSN`, `_USER` e `_PASSWORD` no ambiente. Não existe fallback para a AME. A conta deve possuir apenas leitura nas fontes homologadas. Fontes de agenda precisam atender ao contrato de campos documentado pelo conector; variações exigem adaptador próprio.

## Consulta e registro de respostas na lista

`appointments/{id}/communications/` retorna mensagens paginadas com conteúdo, número de origem fotografado e respostas recebidas; acrescenta registros manuais do agendamento, com canal, interlocutor e operador. A unidade é verificada no backend. `cases/{id}/act/` passa a aceitar `record_response`, com versão, contato, interlocutor, canal phone/whatsapp, resultado confirmed/declined e data/hora. A ação só aceita agendamentos sem resposta atual e não chama transporte.

Número de envio é preservado no snapshot ao enviar (configuração opcional `META_DISPLAY_PHONE_NUMBER`) e/ou ao receber metadados autenticados do provedor. O identificador técnico META_PHONE_NUMBER_ID não é tratado como telefone. Nome do respondente vem de contacts/profile quando o webhook o fornece; registros antigos sem nome não são preenchidos por inferência. Simulações são identificadas como tal.
