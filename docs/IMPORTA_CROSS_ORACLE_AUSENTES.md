# Ausentes: Oracle e planilha

No Importa CROSS, **Gerar ausentes** abre um formulário de data, tipo, modelo de ausentes e template opcional. A importação por arquivo continua disponível.

- `A`: Consulta; `I`: Imagem / Exames; `L`: Laboratório.
- Usa a conexão Oracle criptografada da unidade selecionada. Não aceita SQL, host ou credenciais no formulário.
- Consulta somente leitura em `DBAMV.IT_AGENDA_CENTRAL`, `AGENDA_CENTRAL`, `ITEM_AGENDAMENTO` e `PACIENTE`.
- Filtra `CD_ATENDIMENTO IS NULL`, `CD_PACIENTE IS NOT NULL`, `DT_AGENDA >= :start_day AND DT_AGENDA < :end_day` e `TP_ITEM = :item_type`. Não depende do formato NLS de datas. Horários vêm de `HR_AGENDA`.
- Sem atendimento vinculado é o critério de seleção; não comprova falta clínica.
- Telefones da agenda e do paciente são normalizados e deduplicados. Não inventa DDD. Vários contatos não duplicam o agendamento. Registros sem contato válido ou identidade ficam com erro na prévia e não liberam o lote.
- Aplica o contrato dos 12 campos padronizados e o mapa de parâmetros do modelo de ausentes. `tipo2` contém o tipo de atendimento; `data_nascimento` vem do Oracle.
- Guarda origem, data, tipo, versão da consulta e fotografia do template em `SheetImport.configuration`. Identificador externo `oracle:<CD_IT_AGENDA_CENTRAL>` separa os códigos Oracle dos códigos de arquivo. Repetir o mesmo conjunto e configuração reaproveita o lote.
- Uma geração sem erros cria os registros de acompanhamento de ausentes, contatos e histórico, visíveis em Agendamentos. Erros mantêm o lote em prévia. A geração nunca cria mensagens nem ativa o lote.
- A ativação explícita mantém o fluxo existente: template obrigatório, fila em +30 minutos, controles de unidade, destinatários e modo de operação preservados. Nenhum controle global de envio é alterado.
- Filtros de origem e tipo na lista de importações; filtros específicos de ausentes em Agendamentos.

## API

`POST /api/v1/sheet-imports/oracle-absences/?unit=ame`

Exige sessão com permissão de escrita em Importa CROSS, acesso à unidade e `Idempotency-Key` de 8 a 100 caracteres.

```json
{"layout": 1, "absence_date": "2026-10-20", "item_type": "A", "template": 6}
```

`template` é opcional; sem seleção usa o padrão do modelo, se cadastrado. Resposta segue o contrato de `SheetSerializer`.

Filtros: `GET /api/v1/sheet-imports/?unit=ame&origin=oracle&item_type=A`; origem `sheet` mantém apenas arquivos. Em Agendamentos: `kind=cross:absence:A`, `cross:absence:I`, `cross:absence:L`.

Limites: 10.000 registros por consulta, timeout de chamada no máximo 15s, rollback garantido, erros de conexão sem credenciais ou dados de pacientes. Não cria agendador automático nem escreve no hospitalar.
