# Relações de dados do ROB8

Mapa consolidado em 12/10/2026 a partir da interface e dos arquivos locais da investigação. Esta etapa não executou SQL ou procedures nos servidores.

## Instância do painel 172.16.0.123

A configuração anteriormente lida do G4LightWEB aponta para `C:\WhatsReport\Servidor\BD\GLDADOS.FDB`. A instalação também possui `BASE.FDB`, usado por componentes do motor. Esses arquivos não devem ser tratados como um banco único sem validar a conexão efetiva de cada componente. A estrutura abaixo foi identificada nas consultas extraídas do executável do painel e nos metadados já coletados; não foi feita uma nova inspeção das constraints.

| Objeto | Papel | Campos/ligação identificados |
|---|---|---|
| `TBAVISOS` | Avisos, parâmetros do agendamento, texto, envio e resposta exibidos pelo painel | `ID_AVISO`, `SEUID`, `TIPO`, `CELULAR`, `DATA_AGENDAMENTO`, `PARAM*`, `MENSAGEM`, `IDMENSAGEM`, `STATUS_MENSAGEM`, `RESPOSTA`, `DATA_RESPOSTA` |
| `TBTIPOS` | Cadastro dos 12 tipos de envio | `TIPO`, `FILTRO`, `MENSAGEM`, `LEMBRETE`, `APRESENTAR_PESQUISAS` |
| `TBPREPAROS` | Cadastro de preparos por exame | Busca por `EXAME`; conteúdo exibido como preparo. O nome físico da coluna do texto ainda precisa ser conferido no schema desta instância |
| `TBAVISOS` (campos de atendimento) | Encerramento manual e contato telefônico | `PACIENTE_ENCERROU`, `USUARIO_ENCERROU`, `OBSERVACAO_ENCERROU`, `RESPOSTA`; filtros também usam `LIGACAO_NAO_ATENDIDA`, `STATUS` |

### Tipo de envio

O executável faz `SELECT FILTRO FROM TBTIPOS WHERE TIPO = ...` e usa o resultado para filtrar `TBAVISOS.TIPO`. Logo, o nome exibido no menu e o texto registrado no aviso são coisas distintas.

Exemplo observado:

```text
TBTIPOS.TIPO = Agendamentos
TBTIPOS.FILTRO = CONFIRMA AGENDAMENTO AME VOTUPORANGA
                    |
                    v
TBAVISOS.TIPO = CONFIRMA AGENDAMENTO AME VOTUPORANGA
```

Outro exemplo: `TBTIPOS.TIPO = Busca Ativa` e `FILTRO = PÓS CIRÚRGICO`. Não confundir com `BUSCA ATIVA CDR`.

`TBTIPOS.MENSAGEM` corresponde ao modelo com marcadores; `LEMBRETE` é o nome do template para aviso de inclusão mostrado no formulário, vazio nos 12 tipos examinados. Esse campo vazio não identifica o template oficial usado pelo transporte Meta.

### Agenda, mensagem e resposta

`ID_AVISO` identifica o registro local. `SEUID` é usado para agrupar/relacionar avisos do evento de origem; não deve ser confundido com identificador de paciente. O painel conta mensagens com `COUNT(ID_AVISO)` e eventos com `COUNT(DISTINCT(SEUID))`, conforme os fragmentos extraídos. `IDMENSAGEM` identifica a mensagem do transporte e é diferente de ambos.

Os filtros extraídos do painel usam:

```sql
-- Classificação do painel: não receberam
RESPOSTA IS NULL AND IDMENSAGEM IS NULL AND STATUS_MENSAGEM IS NULL

-- Classificação do painel: não responderam
RESPOSTA IS NULL AND IDMENSAGEM IS NOT NULL AND STATUS_MENSAGEM IS NOT NULL

-- Destinatário não reconhece o paciente
RESPOSTA IN ('NÃO CONHEÇO ESSA PESSOA', 'NAO CONHECO ESSA PESSOA')
```

Esses critérios são do legado; ausência de identificador não é prova definitiva de ausência de entrega no provedor.

### Preparo

O executável consulta `TBPREPAROS` por `EXAME`. As opções de exame/consulta são obtidas por `SELECT DISTINCT(PARAM13)` e `SELECT DISTINCT(PARAM7)` em `TBAVISOS`. Isso comprova uma associação por texto/nome no programa, não uma FK por código de exame. Ainda falta confirmar como o motor insere o preparo na mensagem e o tratamento de nomes divergentes.

### Variáveis

Pelos textos e SQL de exibição: `PARAM6` paciente, `PARAM7` especialidade/procedimento, `PARAM13` complemento/exame, `PARAM8` profissional, `PARAM9` horário. O modelo usa ainda `PARAM3` para data e `PARAM12` para chegada. `PARAM19/PARAM20` mudam de papel entre transferência e reagendamento; não são uma semântica global confiável.

## Motor de importação e transporte: evidências de outras instâncias

Na investigação de `172.16.0.124`, foi confirmado em `BASE.FDB`:

```text
TBAGENDADOR_ENV_REL -> TBRELATORIO -> TBBASES / Oracle
                                         |
                            tabelas locais de importação
                                         |
                               gatilhos -> TBAVISOS
                                         |
                     procedures de lembrete -> novos TBAVISOS
                                         |
                       transporte / ação de resposta -> TBAVISOS
```

`TBRELATORIO.ID_BASE` aponta para a conexão cadastrada; `COMANDO_VIEW` contém o SQL de origem. Os gatilhos examinados usam `UPDATE OR INSERT ... MATCHING(CELULAR, SEUID, TIPO)`. Os lembretes criam outro aviso, em certos fluxos com `SEUID = 'L' || identificador_original`. Ações em `TBACTIONS_CLICK_BUTTON` podem atualizar `TBAVISOS.RESPOSTA` usando `SEUID`.

Cadastros `TBMSG_TEMPLATE` e mapas com `ID_TEMPLATE`, `NRO_VARIAVEL` e `PARAMETRO` foram lidos nas investigações do transporte oficial. Essas relações não devem ser transplantadas como se todos os campos, IDs e templates fossem idênticos no painel `172.16.0.123`.

## Fontes locais

- [Fragmentos SQL do painel](../../WhatsReport_172.16.0.124/Busca_Ativa_123_Consultas_Executavel.txt): tipos, preparos e encerramento telefônico.
- `C:\Users\DELL\Documents\WhatsReport_172.16.0.124\Investigacao_172.16.0.123_2026-10-08.md`: conexão do módulo web e componentes.
- `C:\Users\DELL\Documents\WhatsReport_172.16.0.124\Documentacao_WhatsReport_ROB8.md`: importação, gatilhos e procedures da instância 124.
- [Inspeção do painel](ROB8_PANEL_REVIEW.md): correspondência dos formulários e tipos observados.

Não foram confirmadas as FKs, índices e cardinalidades físicas completas da instância 123. O mapa distingue os vínculos implementados pelo programa das constraints do banco.
