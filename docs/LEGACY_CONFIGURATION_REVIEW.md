# Revisão das configurações legadas

## Redundâncias confirmadas

- **Regras de lembretes** e **Origens e regras → Regras de agendamento** exibem e editam o mesmo recurso `/api/v1/rules/`. As duas apresentações recebem etiqueta Legado; os registros são preservados.
- As regras internas `oracle-window-*` são criadas por **Agendas e templates Oracle**. Para essas agendas, view, template, mapeamento, antecedência, horário e calendário devem ser editados na agenda. A edição pelo formulário genérico pode produzir divergência; a futura consolidação deve impedir essa edição e direcionar para a agenda correspondente.
- **Lembretes e envios → Templates de mensagens** apresenta templates locais e seu mapa antigo. As novas agendas mantêm mapeamentos próprios e fotografias versionadas usando o catálogo Meta da unidade. O painel e seu modal recebem etiqueta Legado. Ele continua disponível para os fluxos antigos.
- A referência `legado #` era exibida mesmo sem identificador. Agora só aparece quando existe referência.

## Configurações com responsabilidades diferentes

- **Oracle** configura conexão e credenciais; **Agendas e templates Oracle** configura cada view e sua importação. Ambas são necessárias.
- **WhatsApp / Meta** configura canal, credenciais e catálogo do provedor. O template local antigo não substitui esse catálogo.
- **Controle de envios** continua controlando pausa, modo e destinatários autorizados. Esses controles permanecem ativos, mesmo dentro da tela que contém áreas legadas.
- O prazo padrão da unidade e os prazos por finalidade são escopos diferentes. Não devem ser eliminados como duplicidade sem consolidar a precedência.
- **Importações e auditoria** e **Logs de execução** são visões distintas de monitoramento; sem evidência para classificá-las como legadas.
- As origens e regras pós-cirúrgicas não foram substituídas integralmente pelas novas agendas de consultas/exames/laboratório. A etiqueta na categoria Origens e regras indica a interface anterior; não significa que todos os seus fluxos possam ser removidos.

Nenhuma regra, integração, permissão ou dado foi removido nesta revisão.
