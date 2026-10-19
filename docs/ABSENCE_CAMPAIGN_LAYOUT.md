# Modelo de importação de ausentes — AME Votuporanga

Fontes fornecidas pelo administrador: `normalizar_agendamentos.py` e relatório `Agendamento_Ausentes-13_10_2026_14-37-55.xls`. Análise local, sem alteração dos arquivos originais ou importação de pacientes no banco do Órbita.

## Estrutura confirmada

O arquivo é HTML em Windows-1252, exportado com extensão `.xls`. O normalizador fornecido reconhece esse formato e rejeita Excel binário/XLSX. Valida onze colunas: Código, Paciente, Telefone, Data, Horário, Exame, Solicitante, Executante, Profissional, Motivo e Observação.

O identificador do agendamento vem do input `ID_HOR[...]`, e não do Código. Código identifica o paciente. Ambos devem permanecer como texto. A identificação de paciente deve combinar unidade, origem e código; telefone compartilhado não é identidade de paciente.

Na amostra: 72 agendamentos únicos, 64 códigos de paciente, todos em 09/10/2026 e todos com executante AME VOTUPORANGA. Sete pacientes aparecem em mais de um agendamento. A contagem independente dos inputs HTML confirmou os mesmos 72 identificadores.

Há 28 agendamentos com um contato, 36 com dois e oito com três. O normalizador encontrou 107 números distintos no total e nenhum aviso de formato. Dois números são compartilhados por códigos de paciente diferentes. Isso não comprova existência, titularidade ou disponibilidade no WhatsApp.

## Motivos e observações

64 agendamentos não têm motivo informado. Oito já possuem motivo: quatro por impossibilidade de contato, dois por enfermidade, um por desistência e um por internação. Os mesmos oito possuem observação; não há observações entre os registros sem motivo. Não se deve inferir outro motivo a partir do conteúdo livre.

Decisão do administrador: incluir todos os 72 agendamentos na campanha, inclusive os oito com motivo informado. Motivo/observação provenientes do relatório devem ser preservados separadamente das respostas recebidas pelo Órbita.

## Mapeamento para o Órbita

| Origem | Destino |
| --- | --- |
| ID_HOR | Identificador externo do agendamento/evento |
| Código | Identificador externo do paciente |
| Paciente | Nome original |
| Telefone | Contatos distintos do mesmo agendamento |
| Data + Horário | Data do atendimento, com fuso definido pela unidade |
| Exame | Procedimento original |
| Solicitante / Executante / Profissional | Metadados de origem |
| Motivo / Observação | Dados originais do relatório, sem sobrescrever respostas |

O importador aceita CSV/XLSX para CDR e HTML `.xls` de ausentes por layout específico `absence_html`. O parser incorporado foi revisado a partir do modelo fornecido; scripts enviados por upload nunca são executados. A confirmação de ausência preserva os dados de origem, cria contatos vinculados à identidade do paciente e não gera mensagens. A reimportação do mesmo arquivo retorna a importação existente.

O fluxo de ausência deve manter um agendamento com seus múltiplos contatos, prévia de erros/duplicidades, identidade estável e reimportação idempotente. A seleção de destinatários e a liberação da campanha são etapas distintas. Uma reimportação não deve disparar mensagens, apagar respostas ou concluir que um paciente saiu da lista porque não aparece em outro arquivo.

Os registros desta amostra não são sintéticos. Não foram substituídos os telefones por um número de teste, e não foi habilitado envio para os pacientes. O transporte de piloto atual é de agendamentos sintéticos e não representa um template de solicitação de motivo de ausência.

## Importação aplicada

Campanha local `Ausentes - 09/10/2026`, unidade AME, em rascunho: 72 agendamentos e 64 pacientes. Os contatos originais e oito motivos/observações foram preservados. Sem template ou horário de envio selecionado; nenhuma mensagem gerada. Backup PostgreSQL criado antes da aplicação.

## Envio de teste

Campanha habilitada explicitamente pelo administrador. Ativar/desativar envio verifica a unidade, perfil administrativo e versao do registro. Ativar nao cria mensagens: Enviar agora exige liberacao no modal. A liberacao cria uma mensagem por contato, conserva um registro por agendamento e verifica o template aprovado confirmacao_consulta_sqlite_v1. SIM/NAO sao classificados como confirmed apenas para esta politica de teste, preservando a resposta original. O Flow antigo continua dependendo do endpoint legado.

Desativar bloqueia as proximas tentativas sem apagar a fila. Mensagens ja em processamento podem terminar. Transporte valida configuracao, template, unidade, contatos autorizados da campanha, revisao de origem, opt-out e limite diario de 30 tentativas por unidade. Intervalo minimo de 5 segundos entre tentativas da campanha. Resultados incertos nao sao reenviados automaticamente.
