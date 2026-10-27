# Regressão de envios e agendas Oracle

## Executar sem envio real

No servidor do Órbita:

```sh
cd /opt/orbita
./scripts/run-send-regression.sh
```

O script cria um nome exclusivo para a base PostgreSQL de testes (`test_orbita_regression_*`), usa `SEND_MODE=simulated`, desativa `META_REAL_ENABLED`, desliga Redis e o consumidor de inbox e executa tarefas apenas no processo de testes. O código da aplicação é montado somente para leitura. Os cenários novos recusam qualquer execução fora de uma base `test_*` PostgreSQL.

O adaptador Oracle é substituído por um banco fictício que aceita apenas SELECT com limites de data parametrizados, exige transação somente de leitura e verifica rollback. Qualquer tentativa de chamada HTTP ou transporte Meta nos testes novos falha imediatamente. O runner também aponta proxies HTTP/HTTPS para uma porta local fechada.

Dados reais de pacientes não são importados. As tentativas de entrega usadas para testar sucesso/falha/repetição existem apenas na base de testes e usam transporte local com identificador `sim.*`. Mensagens originadas da integração Oracle continuam bloqueadas, inclusive se um cenário tentar colocá-las na fila com o modo real habilitado dentro do processo isolado.

O JUnit é salvo em `/opt/backups/orbita/send-regression-*/junit.xml`; é possível informar uma pasta de resultados como primeiro argumento. Django remove a base de testes ao terminar. Não executar duas chamadas com a mesma pasta de resultados.

## Cobertura

- Consulta real do construtor SQL da aplicação sobre um adaptador fictício: SELECT, datas vinculadas, limite da leitura, sem commit e com rollback.
- Geração de agendamentos, parâmetros, mensagens e grupos; dois telefones no mesmo atendimento, linhas repetidas e reimportação sem duplicidade.
- Janela futura, dias vazios, avanço diário, retomada de falha e revisão dos dados de origem.
- Antecipar fim de semana para sexta; adiar para segunda; sábado na sexta e domingo na segunda; domingo no sábado.
- Preservar grupos nativos de sexta e segunda quando outros grupos chegam à mesma data de envio.
- Mudança de mês e ano; ajuste para após o atendimento; calendários inválidos.
- Dados conflitantes na origem e exclusão/alteração durante a importação.
- Duas importações concorrentes; dois operadores na mesma versão (um sucesso e um 409); troca de calendário durante consulta sem gravar programação obsoleta.
- Dois workers para a mesma mensagem: nenhuma entrega Oracle e apenas uma tentativa no transporte local para o cenário sintético.
- Falha definitiva, resultado incerto sem repetição automática, falha temporária com espera e retomada.
- Mais de uma origem, isolamento entre unidades, permissões, fotografias e histórico das revisões.

## Verificação do Oracle de homologação

Esta etapa é separada da suíte automática e usa somente metadados e contagens da origem configurada:

```sh
cd /opt/orbita
docker compose exec -T api python manage.py shell < scripts/check-oracle-agenda-readonly.py
```

Por padrão, verifica Sansaúde. A conexão deve ser identificada como HML/HOMOLOG. Para cada agenda ativa, valida as colunas e conta linhas e identificadores distintos na janela, com parâmetros de data. A transação Oracle é somente de leitura e termina com rollback. Não seleciona nomes/telefones, não exporta linhas de pacientes e não cria agendamentos ou mensagens na aplicação.

## Resultados e limites

A suíte automática comprova o comportamento com dados fictícios e concorrência PostgreSQL. A leitura de homologação comprova conectividade e compatibilidade da view configurada na ocasião. Nenhuma etapa valida a entrega real pela Meta. O envio permanece desativado para esta integração.


## Integração com os testes normais

Os módulos `test_oracle_agendas.py`, `test_oracle_send_regression.py` e `test_reminder_refresh.py` fazem parte da descoberta padrão e têm o marcador `send_regression`. A execução normal de `pytest` inclui esses cenários. O filtro `-m send_regression` seleciona os 53 cenários do grupo atual; o runner usa o marcador em vez de uma lista fixa de arquivos.

O serviço Compose `tests` monta o backend atual em modo somente de leitura, usa `DATABASE_NAME=orbita_suite` (Django cria `test_orbita_suite`), força modo simulado e depende apenas do PostgreSQL. Não inicia a API, workers ou scheduler como dependências da execução dos testes. Os serviços ativos da aplicação continuam com sua configuração de execução própria.
