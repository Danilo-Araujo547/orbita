# Logs operacionais

Configurações → Logs consulta registros da unidade selecionada, com paginação e filtros por tipo, situação, período e busca. Requer leitura em Configurações. Instâncias remotas consultam o servidor de origem.

- Consultas às fontes: última execução diária por regra, quantidade importada e erro.
- Execuções de regras: fluxos executados e resultados.
- Importa CROSS: estado da importação e duplicidades.
- Mensagens: estado atual, destinatário, tentativas e identificador Meta. A data é a última atualização; esta lista não representa cada transição.
- Tentativas de envio: um registro por tentativa com início, conclusão e resultado.
- Eventos da Meta: transições recebidas para mensagens identificadas na unidade e no canal.
- Relatórios: geração, conclusão e erro; não inclui o conteúdo do arquivo.
- Auditoria: ação, responsável e referência. Detalhes arbitrários, credenciais e corpos de mensagens não são expostos.

Os filtros de data usam o fuso da unidade e incluem o dia final inteiro. O histórico existente é consultado sem copiar registros. Importações atualizadas no mesmo dia mantêm a execução diária existente. Logs de stdout do sistema operacional não fazem parte desta tela.

API: GET /api/v1/logs/?unit=ame&category=attempts&status=failed&start=2026-10-01&end=2026-10-31&search=numero&page=1
