# Fonte SQLite simulada

O PostgreSQL mantém os dados da aplicação. O arquivo `data/simulated_appointments.sqlite3` é somente uma origem de leitura para a unidade definida em `SIMULATED_SQLITE_UNIT` (AME nesta instalação).

A view `VW_AGENDAMENTOS_SIMULADOS` contém 30 atendimentos fictícios, 10 em cada mês de outubro a dezembro de 2026. Nesta instalação, todos usam um único contato de teste definido pelo administrador, também atualizado na origem SQLite. O gerador original permite múltiplos contatos; cada atendimento permanece único e cada contato recebe sua própria mensagem.

`SIMULATED_SQLITE_PATH` seleciona a fonte local. Sem esta configuração, a importação continua usando Oracle. A leitura da view é parametrizada, restrita à unidade e aberta em modo somente leitura. Nenhuma conexão ao servidor legado é necessária.

Criação e importação inicial: `.venv/Scripts/python.exe backend/manage.py seed_simulated_source`. Repetir o comando preserva o arquivo existente. Em Configurações → Atividades → Adicionar importação, o botão **Importar SQLite simulado** atualiza os registros sem duplicar atendimentos ou mensagens. Uma regra existente por tipo é utilizada, sem habilitar regras desativadas.

Em Grupos → Editar envio, **Disparar agora** libera somente as mensagens ainda não tentadas do grupo selecionado. O intervalo informado é respeitado por um dispatcher local iniciado por `scripts/Start-Local.ps1`. O grupo não pode conter dados reais ou atendimentos vencidos. Erros de contato, recusa, bloqueio de contato, revisão ou parâmetros impedem a liberação.

O disparo exige permissão administrativa da unidade, versão atual e chave de idempotência. A liberação é auditada. Mensagens aceitas, incertas ou já tentadas não são reenviadas por esta ação. A pausa geral, regras e lista de destinatários de teste não são modificadas.

No modo simulado, este caminho usa exclusivamente `SimulatedTransport`, sem rede e com identificadores `sim.*`. A aceitação simulada não representa entrega nem resposta de WhatsApp. A habilitação explícita posterior de envio real está documentada em [Envio real de teste](META_PILOT.md); somente grupos liberados nesse modo usam a Meta.

APIs em `/api/v1/`:

- `POST imports/simulated/?unit=ame` — reimporta a origem local configurada.
- `POST appointment-groups/{id}/dispatch-now/?unit=ame` — corpo `{ "version": 1, "delay_seconds": 10 }`.
- Ambas exigem `Idempotency-Key`; conflito de versão retorna `409`.

Para pausar uma fila liberada, altere sua programação para uma data futura. `scripts/Stop-Local.ps1` também interrompe o dispatcher; mensagens pendentes são retomadas ao iniciar novamente.
