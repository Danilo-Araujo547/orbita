# Regressão de envios e agendas

Executada em 19/10/2026 22:13 (America/Sao_Paulo).

- **53 testes passaram; 0 falhas e 0 erros.**
- Banco de testes PostgreSQL exclusivo, removido pelo Django ao terminar.
- Adaptador de origem fictício exercitando o construtor SQL real, sem conexão externa nos cenários automáticos.
- Transporte de entrega local simulado; HTTP e transporte Meta proibidos.
- Estado da aplicação Sansaúde preservado: 273 agendamentos, 273 mensagens existentes, envio pausado e **0 tentativas reais**, antes e depois.

## Origem Oracle de homologação

View: `DBASISTEMAS.VDIC_CONS_AGENDA_ENVIO_MSG_SAN`. Janela: 2026-10-20 a 2026-10-29.

**277 linhas / 273 agendamentos distintos**. Colunas mapeadas conferidas. Transação somente de leitura com rollback. Nenhuma linha identificável exportada e nenhuma importação criada na aplicação.

## Cenários validados

- Consulta, parâmetros, geração de agendamentos/grupos e múltiplos telefones sem duplicidade.
- Janela futura, reimportação, falha parcial e retomada.
- Os quatro modelos de antecipação/adiamento; preservação dos grupos de sexta e segunda; viradas de mês e ano.
- Programação posterior ao atendimento bloqueada; correção encerra a pendência anterior.
- Revisão de calendário invalida prévias antigas; alteração durante uma consulta impede gravar a versão obsoleta.
- Linhas conflitantes da origem ficam bloqueadas.
- Concorrência PostgreSQL: importadores, operadores (200/409), workers e tentativa única no transporte local.
- Falha definitiva, falha temporária com espera e nova tentativa, resultado incerto sem repetição automática.
- Isolamento de unidades, múltiplas origens, permissões, histórico e idempotência.

No primeiro ciclo houve uma expectativa incorreta de dia da semana no teste de virada de ano; o dado de teste foi corrigido. A execução completa final passou. Não foi necessário alterar o código de produção nesta regressão.

## Repetir

```sh
cd /opt/orbita
./scripts/run-send-regression.sh
```

Instruções: `/opt/orbita/docs/REGRESSAO_ENVIOS.md`.
Resultados desta execução: `/opt/backups/orbita/send-regression-20261020-010501/junit.xml`, `summary.json`, `run.log` e `oracle-readonly.log`.
