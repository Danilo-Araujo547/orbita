# Busca ativa - pós procedimento

Configurações → Agendas Oracle → AME Votuporanga (seleção de unidade na barra lateral).

## Origem e referência

- Conexão Oracle já cadastrada e criptografada da AME: prdamevo, host 172.19.0.250. Não altera a conexão de homologação do Sansaúde.
- View DBASISTEMAS.VDIC_BUSCA_ATIVA_ENVIO_MSG, somente leitura.
- DATA_REALIZADO é VARCHAR dd/mm/aaaa (confirmado na definição da origem). O filtro usa igualdade com parâmetro, sem conversão implícita NLS.
- CD_PRINCIPAL identifica o procedimento; PRONTUARIO identifica o paciente. PACIENTE, TELEFONE, CIRURGIA, PRESTADOR e TP_CIRURGIA alimentam os campos correspondentes.
- O fluxo preserva as exclusões existentes na view; não altera SQL nem dados do hospitalar.

## Programação

- Padrão: 10 dias após DATA_REALIZADO, às 09:00 no fuso da unidade. Intervalo, horário, dias permitidos e antecipação/adiamento são editáveis no modal.
- Histórico padrão: últimos 30 dias, incluindo hoje; nunca consulta procedimentos futuros. Deve cobrir o intervalo após o procedimento mais 7 dias para permitir ajustes de fim de semana.
- Importação contínua, quando habilitada com template aprovado, revisita o histórico a cada 60 minutos (editável). Identidade de origem e revisão impedem duplicidade; telefones adicionais pertencem ao mesmo procedimento.
- Sem recuperação automática de envios vencidos: a validade termina no fim do dia programado ou na validade da regra, o que ocorrer primeiro. A data passada do procedimento não expira o acompanhamento pós-procedimento.

## Template pendente

A unidade ainda não tem template específico. A configuração pode ser salva pausada, sem template e sem parâmetros. “Atualizar dados” importa apenas os procedimentos: não cria mensagens ou notificações. A ativação automática exige selecionar um template aprovado no catálogo Meta da unidade e mapear todos os parâmetros.

Mesmo com um template selecionado, a integração Oracle continua em prévia, protegida pelo bloqueio oracle_agenda_preview_only. Esta entrega não libera envio real.

O acompanhamento usa a finalidade pós-cirúrgica existente: SIM informa estar bem; NÃO requer atenção e prioridade da equipe, conforme a pergunta já documentada na view. O template definitivo deve manter essa semântica. Nenhum diagnóstico é gerado.

## Validação

Os testes usam fontes e destinatários fictícios; cobrem datas após o procedimento, virada de mês/ano, anos bissextos, dias permitidos, múltiplos contatos, repetição da importação, rascunho sem fila, mapeamento, parâmetros, validade e proteção de envio real. As consultas ao Oracle executam SET TRANSACTION READ ONLY e rollback.
