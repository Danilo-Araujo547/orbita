# Agendamentos e Importa CROSS

Agendamentos usa uma consulta unificada por unidade: agendamentos existentes e registros de acompanhamento do Importa CROSS. Nenhum registro importado é copiado para Appointment; o mesmo acompanhamento mantém contatos, mensagens, respostas, observações e histórico.

O seletor Tipo inclui Consulta, Exame e Laboratório e as finalidades cadastradas em Importa CROSS para a unidade. Tipos importados aparecem em um grupo separado. Relatórios não entram na agenda. As datas dos registros CROSS correspondem à data do evento importado, inclusive a consulta que originou uma ausência; não são novos agendamentos futuros.

Todos os filtros, paginação, exportação e mensagens consultam os registros da unidade. Vários telefones e várias campanhas vinculadas ao mesmo acompanhamento não duplicam a linha. Finalidades diferentes permanecem distintas.

As confirmações rápidas são específicas de consultas/exames. Para finalidades CROSS, abra o registro para classificar uma resposta no contexto correto. Observações e mensagens ficam disponíveis na lista.

Os seletores permitem buscar opções, usar setas e Enter para selecionar, Escape para fechar e Tab para continuar a navegação.

API de leitura: /api/v1/agenda-items/, /api/v1/agenda-items/types/, /api/v1/agenda-items/export/, /api/v1/agenda-items/{id}/communications/.

Agendamentos existentes usam seu ID; registros CROSS usam cross-{id do acompanhamento}. /api/v1/appointments/ permanece compatível.
