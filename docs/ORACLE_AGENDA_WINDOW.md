# Agendas e templates Oracle

Configurações → Agendas e templates Oracle, exclusivo de administrador com permissão de edição de Configurações na unidade local. A seleção de unidade permanece na barra lateral. Cadastro e alteração abrem modal.

## Sansaúde em homologação
View DBASISTEMAS.VDIC_CONS_AGENDA_ENVIO_MSG_SAN, banco hmlvotu.
Janela padrão: amanhã até hoje + 10, incluindo dias sem atendimento e finais de semana. Antecedência do lembrete é outra configuração: padrão de cinco dias, horário 09:00, ambos editáveis. Não confundir dez dias de importação com antecedência de envio.

Primeira execução consulta cada uma das dez datas; seguintes completam apenas datas ainda não importadas na versão. Quando o dia avança, entra a nova data final. Dias vazios são registrados. Falhas ficam explícitas e datas faltantes são retomadas após intervalo; Atualizar dados relê a janela toda para capturar alterações e novos registros. Registros anteriores permanecem no histórico; não excluir por terem saído da janela.

Colunas do agendamento e telefones são selecionáveis. Parâmetros do template são mapeados por chave e formato: texto/data/hora. Datas são formatadas dd/mm/aaaa e horas hh:mm. Templates carregados da Meta da própria unidade: somente APPROVED pt_BR, texto/QUICK_REPLY e cabeçalho textual estático. DOCUMENT, URL e FLOW ficam indisponíveis nesta primeira integração; não existe envio parcialmente montado. INATIVO e hello_world não são elegíveis.

Template inicial Sansaúde: lembrete_sansaude.
BODY 1 = PACIENTE, 2 = MEDICO, 3 = DTA_AGENDA (data), 4 = HORA_MARCADA (hora).
CELULAR identifica os destinatários. São permitidas várias colunas; números separados por ponto e vírgula, vírgula, barra vertical, quebra de linha ou espaço/barra/espaço também são reconhecidos.
Linhas com o mesmo CD_AGENDA são consolidadas em um agendamento, com contatos distintos. Dados não telefônicos conflitantes geram bloqueio de revisão, não duplicidade. CD_PACIENTE vincula o paciente, nunca apenas o telefone.

Importação utiliza SELECT em transação Oracle somente leitura e rollback, intervalo de datas semiaberto com binds, identificadores validados e limite de 10.000 linhas por dia. Não grava no Oracle ou log legado. ENVIAR/DT_ENVIAR não são filtros implícitos: esta etapa carrega a view para análise; a regra hospitalar de elegibilidade de envio precisa ser definida antes de produção.

## Operação
A importação automática é executada pelo agendador; ativar importação não ativa mensagens.
Mensagens deste conector ficam em prévia/bloqueadas/expiradas conforme os dados e horário; nunca são promovidas à fila automaticamente. Datas cujo horário de envio já passou podem aparecer expiradas. A unidade de homologação permanece pausada.
Há um Rule interno desabilitado; o importador legado não o executa. Alterações de configuração versionam esse Rule, cancelam prévias pendentes antigas e retomam a janela com os novos bindings. Enviados, incertos e histórico são preservados.
Estado de execução possui lease; dois workers não importam simultaneamente a mesma configuração. Cada data salva dados e marcador de conclusão na mesma transação. Verificação de versão impede commit se a configuração mudar durante a leitura.
Catálogo/canal da Meta são conferidos antes da leitura. Alteração de WABA/número/template invalida a execução até revisão. Cada mensagem preserva view, versão, mapeamentos, template/canal e parâmetros utilizados.

## API
GET /api/v1/oracle-agendas/?unit=slug
POST inspect/: view_name; apenas metadados.
POST configure/: version, view_name, column_mapping, template_id, parameter_mapping, horizon_days, days_before, send_time, enabled. Idempotency-Key obrigatório.
POST synchronize/: version, refresh=false para completar, true para reler. Idempotency-Key obrigatório; tarefa assíncrona.
Isolamento por unidade e proibição de configuração pelo proxy de instância. Conflitos de versão retornam 409. Erros salvos não incluem SQL, credenciais ou conteúdo identificável.

Credenciais Oracle e token Meta continuam cifrados; não são devolvidos pela API dessa configuração.


## Exclusão de configuração
Excluir abre confirmação no modal. A exclusão é recuperável: interrompe a importação automática, invalida workers antigos por versão e cancela as prévias pendentes. Agendamentos importados e histórico são preservados. A configuração sai da lista ativa e pode ser restaurada pelo botão Restaurar configuração; a restauração mantém a importação automática pausada até edição explícita.
POST remove/ e restore/: version, Idempotency-Key, administrador com edição de Configurações. Nada é excluído no Oracle ou na Meta.


## Várias agendas por unidade

Em **Configurações → Agendas e templates Oracle**, a lista mostra as origens ativas. **Nova agenda** abre o formulário para cadastrar nome, tipo (consulta, exame ou laboratório), view, mapeamento de colunas, template Meta, parâmetros, janela, antecedência e horário. Cada agenda tem detalhes, contagem diária, atualização, exclusão e restauração próprios. A conexão Oracle e o catálogo Meta continuam pertencendo à unidade selecionada.

A janela padrão permanece em 10 dias futuros, incluindo dias sem registros. Cada origem mantém sua regra e a identidade `oracle-agenda:{id}`. Telefones diferentes do mesmo atendimento são consolidados dentro da origem. Não se deduplicam identificadores entre views independentes nem pacientes pelo telefone.

Os parâmetros e o conteúdo usados na prévia são obtidos da fotografia versionada da própria origem. Selecionar o mesmo template Meta em duas agendas não compartilha nem sobrescreve seus mapeamentos. Alterar uma agenda invalida apenas as prévias de sua regra. A consulta de paciente usa a view informada; o fallback local só consulta registros da mesma origem e da mesma view.

### Contrato API

- `GET /api/v1/oracle-agendas/?unit=...` retorna `configurations` e `archived_configurations`. Os campos singulares antigos permanecem apenas quando há uma única configuração ou quando uma configuração foi explicitamente selecionada na resposta de gravação.
- `POST configure/`: criação com `version: 0` e sem `id`; alteração com `id` e versão atual. Inclui `name` e `kind`. O tipo de uma configuração existente é imutável para preservar identidades e histórico; crie outra origem quando precisar de outro tipo.
- `POST synchronize/`, `remove/` e `restore/`: informe `id` e `version`. Sem ID, a compatibilidade é mantida apenas quando existe exatamente uma configuração. Alvo ambíguo retorna 400; versão desatualizada retorna 409. IDs de outras unidades são recusados.
- `POST test_patient/` aceita `id` para restringir o fallback local à origem; uma configuração nova testa exclusivamente a view Oracle.
- Criação, edição, importação, exclusão e restauração exigem idempotência, permissão de configuração e administração da unidade. Nenhuma destas ações habilita o transporte.

A migration `0011` transforma o vínculo da unidade em um-para-muitos e preserva o nome/tipo da regra existente, IDs, mapeamentos, mensagens e histórico. **Os envios da integração Oracle permanecem bloqueados (`oracle_agenda_preview_only`).**


## Calendário de envios

No editor de cada agenda, selecione **Calendário de envios**, os dias permitidos e, para cada dia bloqueado, **Antecipar** ou **Adiar**. O destino é o dia permitido mais próximo na direção selecionada. Os modelos prontos incluem fim de semana na sexta, na segunda, sábado na sexta/domingo na segunda, e segunda a sábado com domingo antecipado para sábado.

O calendário é aplicado depois de calcular `data do atendimento - antecedência`, no fuso da unidade, mantendo o horário configurado. Datas já permitidas permanecem no mesmo dia. O ajuste de sábado não altera os grupos de sexta-feira; mesmo quando compartilham uma data de envio, os grupos continuam separados pela data do atendimento e pela regra/revisão. Esse calendário regula as prévias dos lembretes; a importação continua completando a janela diariamente, inclusive nos dias sem envio.

Se o ajuste programar o lembrete no horário do atendimento ou depois dele, a mensagem fica bloqueada com `send_calendar_after_appointment` e uma pendência para revisão. Não há compensação automática enviando mensagens vencidas. Alterar o calendário cria uma nova versão e invalida as prévias antigas; o recebimento e o histórico são preservados.

API `configure/`: `send_weekdays` usa segunda=0 até domingo=6, com pelo menos um dia distinto. `blocked_day_policy` mapeia o dia original bloqueado em string para `previous` ou `next`. Campos omitidos em edição preservam a configuração existente. A fotografia de cada mensagem registra data nominal, ajustada, efetiva e política. O padrão existente permanece todos os dias, sem deslocamento. O transporte desta integração continua bloqueado para testes de dados.
