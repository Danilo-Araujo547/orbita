# Importa CROSS — Demanda por recurso

Modelo `cross_demand_csv`, específico por unidade, para o CSV Demanda por recurso. Aceita UTF-8 (com ou sem BOM) e Windows-1252, separados por ponto e vírgula. Valida as 31 colunas e sua ordem, incluindo os cabeçalhos repetidos.

## Campos

- Código: identificador do registro da origem, preservado como texto. Não é assumido como identidade global de paciente.
- Nome: paciente.
- Telefone: até três posições; posições vazias `()` são ignoradas. Números repetidos são deduplicados. Todos os números válidos pertencem ao mesmo evento e acompanhamento.
- Município, Especialidade, Tipo Consulta, Profissional, Mês/Ano Pretendido, Turno, Status, Prioridade, Aceita Teleconsulta, Observação e Observação Status: metadados da origem.
- Data Entrada: referência temporal do evento, no formato `YYYY-MM-DD HH:MM:SS`, com fuso da unidade aplicado na prévia.
- Data Agenda e Horário: preservados como metadados; não transformam a demanda em consulta marcada.

As colunas Observação repetidas em históricos de alteração não substituem a observação principal. CID e histórico de alterações não são necessários ao fluxo atual e não são importados.

## Operação

Escolha o modelo na prévia de Importa CROSS. A confirmação deste formato aceita somente Permanência na fila; não libera convocação ou marcação automática. Formar uma campanha e liberar suas notificações continuam sendo ações separadas. Qualificação Pendente é preservado, sem definir por si só elegibilidade de envio.

Reimportar o mesmo arquivo retorna a prévia existente. Registros repetidos no arquivo são contados; identificadores conflitantes e dados alterados em registro já importado exigem revisão. Não há saída automática da fila quando alguém não aparece em um arquivo posterior.

## Validação do modelo recebido

Leitura sem persistência: 72 registros, 72 identificadores distintos, 111 contatos normalizados, zero linhas inválidas e nenhuma Data Agenda preenchida. O arquivo original, nomes, números e observações não são incluídos no repositório ou fixtures. Os testes usam somente dados fictícios. Nenhum paciente foi importado e nenhuma mensagem foi criada na implantação deste modelo.
