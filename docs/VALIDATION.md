# Validação da implementação

Registro de 12/10/2026, no ambiente Windows local. Nenhuma alteração foi feita nos servidores do robô existente ou no banco hospitalar.

## Verificações concluídas

| Verificação | Resultado |
|---|---|
| Backend, regras, permissões, fila, eventos e respostas | 64 testes passaram; 1 teste PostgreSQL ignorado no SQLite |
| Frontend | 3 testes passaram |
| Ruff | Sem erros |
| Migrações | Nenhuma mudança de modelo sem migração |
| OpenAPI | Schema exportado e validado, sem avisos |
| Build React/TypeScript | Concluído |
| Auditoria npm | Zero vulnerabilidades reportadas |
| Painel no navegador | Navegação, autenticação, detalhes e visualização móvel verificados |
| Fluxo simulado | Consulta, exame e laboratório: criação, processamento, entrega e confirmação |

Os testes incluem bloqueio de destinatários reais, isolamento por unidade, revisão de agendamento, deduplicação de eventos, respostas ambíguas, evento fora de ordem, resposta tardia, resultado de envio incerto e montagem do payload oficial. O teste de payload usa transporte HTTP simulado; ele não comprova aceitação por um canal Meta real.

## Oracle

Conexão direta com Oracle 11.2.0.4 validada usando Instant Client 19.32 e modo Thick. Foram conferidos os campos das três views e do log legado.

| Regra | Agendamentos consolidados na validação |
|---|---:|
| consultation-d7 | 375 |
| exam-d7 | 386 |
| lab-d7 | 55 |

Essas contagens são uma fotografia da consulta durante a implementação, não totais permanentes. A validação iniciou uma transação Oracle somente de leitura e desfez as mudanças locais ao terminar. Nenhum paciente real dessas consultas foi mantido no banco local da demonstração. As consultas de consulta e exame exigiram aumentar o timeout de 30 para 120 segundos.

Repetições com contatos diferentes são consolidadas num único agendamento, preservando todos os números; cada número recebe uma entrega da mesma notificação. A ausência na view não cancela um agendamento local.

## Estado entregue e verificações pendentes

- Painel e API executados localmente, com dados fictícios. Envios pausados e template sem validação local ao concluir os testes.
- Nenhuma mensagem real enviada nesta implementação.
- Docker indisponível nesta máquina. Compose, PostgreSQL, Redis, worker e agendador foram preparados, mas ainda precisam de execução integrada. O teste de concorrência com bloqueios PostgreSQL deve ser executado nesse ambiente.
- A validação externa exige credenciais, número e template aprovado de um canal Meta separado. A entrega não altera o webhook do sistema em operação.
- O modo local utiliza SQLite e ciclos manuais; não representa validação de concorrência ou operação contínua em produção.
- Esta versão impede envio a agendamentos reais. Liberar produção exige uma etapa explícita de implementação e validação operacional.
- Retorno de confirmação ou cancelamento ao hospitalar, relatórios sob demanda, busca ativa e pós-cirúrgico permanecem fora deste primeiro módulo.

## Atualização visual e inspeção do legado

Foram acrescentados temas Claro, Escuro e Sistema com preferência persistida, prevenção de flash inicial, controle por teclado e gráficos adaptados. Após revisão solicitada pelo usuário, ambos os temas usam azul institucional/ciano; o escuro usa fundos grafite e azul-marinho. Implementação realizada pelo Gemini via CLI `agy`, seguida de revisão local. A suíte do frontend passou a 13 testes, todos aprovados; build também concluído. Login, alternância claro/escuro, persistência após recarregar e console sem erros foram conferidos no desktop. Não houve envio externo nessa validação.

O levantamento somente de leitura do painel ROB8 em operação está em [ROB8_PANEL_REVIEW.md](ROB8_PANEL_REVIEW.md). Ele distingue cadastros observados de fluxos cuja execução ainda não foi comprovada.

As instruções de execução e os contratos dos módulos estão no [README](../README.md); as regras de origem estão em [LEGACY_RULES.md](LEGACY_RULES.md).
# Evolução operacional — 13/10/2026

- Backend: 95 testes aprovados; dois testes de concorrência PostgreSQL pulados no SQLite. Frontend: 13 testes aprovados; build de produção concluído.
- OpenAPI validado com `--validate --fail-on-warn`, sem avisos; Ruff aprovado; nenhuma migração pendente de geração.
- Migrações aplicadas em cópia privada do banco, com contagens preservadas, integridade SQLite verificada e restauração para uma segunda cópia conferida. Evidência: artifacts/migration-20261013-003926/verification.json.
- Banco local atualizado de forma aditiva: preservados os 390 agendamentos, 390 mensagens, respostas e pendências existentes. Casos criados para os registros locais, sem importar histórico do ROB8.
- Verificação no navegador: Central com 390 casos, registro de observação em paciente fictício, navegação de relatórios/administração e ausência de transbordamento horizontal em 1024, 1366 e 1920 pixels.
- Não houve envio real, alteração de webhook legado, execução de importador legado ou escrita em banco hospitalar.
- Homologações externas, catálogo de estoque, layout CROSS real e piloto operacional permanecem pendentes conforme EVOLUTION_STATUS.md. Não se considera o plano operacional inteiro homologado.


## Revisão de Agendamentos e observações — 13/10/2026

- Backend: **102 aprovados**, dois testes PostgreSQL pulados porque o ambiente local usa SQLite. Frontend: **13 aprovados**, build de produção concluído.
- OpenAPI validado sem avisos; Ruff aprovado; nenhuma migração não gerada.
- Testados múltiplos contatos sem duplicação, idempotência, identidade por origem, confirmação com silêncio, divergências fora de ordem, isolamento de opt-out/número incorreto, rejeição de atribuição de paciente e restrição por unidade.
- Migração antes da aplicação local: artifacts/migration-20261013-012024/verification.json. Backup/restauração após atualização de contatos: artifacts/migration-20261013-013957/verification.json. Contagens preservadas e integridade confirmada.
- Atualização Oracle em transação somente leitura: 375 agendamentos reais locais, 368 identidades de paciente, 210 agendamentos com múltiplos contatos. Zero mensagens novas e zero escrita no Oracle; mensagens antigas preservadas. Não houve envio.
- Agendamentos substitui a atribuição de pacientes; Correções trata apenas intervenções. Sem resposta é filtro e não gera correção automaticamente.
- Observações abre **modal centralizado**, tanto na linha do agendamento quanto no detalhe. Registro pelo modal conferido em paciente fictício, autor/horário preservados, lista e filtros mantidos após salvar. O formulário antigo de observação na tela de atendimento foi retirado.
- Conferidos temas claro/escuro e dimensões desktop 1024, 1366 e 1920; foco, Escape e retorno à lista. Provas visuais: artifacts/observacoes-modal-claro.png e artifacts/observacoes-modal-escuro.png.
- Envios reais continuam bloqueados. Homologação PostgreSQL, fontes externas e piloto continuam pendentes; esta revisão não declara a substituição operacional do ROB8 concluída.

### Correção visual de Agendamentos e modal

Estilos da tabela separados dos contêineres legados; cabeçalho duplicado removido, colunas alinhadas, tipografia/contraste melhorados e ações de observação/correção organizadas. Modal com margens próprias, histórico com rolagem interna limitada e rodapé fixo na composição. Conferidos temas claro/escuro, larguras 1024/1366/1920, altura 720 e associação do botão de salvar ao formulário. Build e 13 testes do frontend aprovados. Sem alteração de dados ou regras de envio. Provas: artifacts/layout-agendamentos-corrigido.png e artifacts/layout-modal-corrigido.png.

### Mensagem e confirmação/recusa na lista

Novos modais conferidos no navegador com pacientes fictícios. Testado o registro de confirmação por telefone sem sair da lista: resultado atualizado, botão de registrar retirado e retorno consultável em Ver mensagem com nome, contato, data/hora, canal e operador. Opções de recusa e WhatsApp conferidas. Testes de backend cobrem ambos os canais/resultados, origem do número do remetente, nome recebido no webhook, proibição de identidade inferida, autorização por unidade/perfil, contato incorreto, data futura e proteção de resposta já registrada. Não houve envio real nem alteração do legado.

Resultado desta entrega: 110 testes de backend e 13 de frontend aprovados; dois de concorrência PostgreSQL permanecem pulados no SQLite. Build, OpenAPI sem avisos, Ruff e verificação de migrações aprovados. Provas visuais: artifacts/ver-mensagem-resposta.png, artifacts/confirmar-recusar-modal.png e artifacts/mensagem-confirmacao-registrada.png.
# Atualização — PostgreSQL local, 13/10/2026

O ambiente local foi migrado para PostgreSQL 18.6 (`127.0.0.1:5432`, banco `orbita`). Os registros anteriores que mencionam SQLite descrevem verificações históricas.

- 194 registros exportados preservados integralmente, com contagens e SHA-256 idênticos entre origem e destino. Usuários, hashes de senha, sessões, configurações e dez agendamentos preservados.
- Backup PostgreSQL restaurado em banco isolado e comparado integralmente. Evidências em `artifacts/postgres-migration-latest.txt` e na pasta indicada por esse arquivo.
- **116 testes de backend aprovados no PostgreSQL**, sem testes de concorrência ignorados. Corrigidos bloqueios de joins opcionais em reprocessamento/relatórios e deadlock entre workers ao inserir auditoria.
- Conta da aplicação sem superusuário, CREATEDB ou CREATEROLE. Autenticação SCRAM-SHA-256, servidor limitado a loopback.
- Migrações sem alterações pendentes, Ruff e OpenAPI validados. Inicialização do cluster pelo script local testada após desligamento completo do servidor PostgreSQL.
- API `/health/` confirma `database: postgresql`; Django Admin mantém a sessão do administrador. Importações e envios reais continuam desabilitados na demonstração.

Guia: [POSTGRESQL_LOCAL.md](POSTGRESQL_LOCAL.md).

