# API do Editor de Canvas de Relatórios

Este documento descreve a especificação técnica dos endpoints da API do Canvas de Relatórios (`/api/v1/reports/<id>/canvas*`), os formatos de requisição e resposta, o contrato de erros estruturados consumido pelo frontend e as extensões retrocompatíveis de schema.

---

## 1. Visão Geral e Autenticação

Todos os endpoints do Canvas:
- Requerem perfil administrativo na unidade (`core.permissions.get_unit(request, ["admin"])`).
- Aplicam isolamento estrito por unidade: um usuário de uma unidade não pode visualizar nem referenciar fontes ou relatórios de outra unidade.
- Operações de escrita e prévia usam cabeçalho `X-CSRFToken` e `Idempotency-Key` (UUIDv4).
- O parâmetro de consulta `?unit=<slug>` identifica o contexto da unidade ativa.

---

## 2. Endpoints

### 2.1. Prévia de Fonte de Dados (`POST /api/v1/reports/<id>/canvas-source-preview/`)

Executa a leitura sob demanda de uma especificação de fonte de dados (sem salvar nem ativar no relatório), inferindo tipos de dados reais, valores nulos, contagens e amostras por coluna.

> **Importante:** SQL e consultas a serviços externos só são disparados quando este endpoint for explicitamente chamado (nunca em `GET` de carregamento de tela).

#### Request Body

```json
{
  "source": {
    "id": "s_faturamento",
    "type": "inline",
    "label": "Faturamento Mensal",
    "columns": ["data", "faturamento", "status"],
    "rows": [
      ["2026-10-01", 15200.50, "concluido"],
      ["2026-10-02", 18400.00, "concluido"],
      ["2026-10-03", null, "pendente"]
    ]
  },
  "parameters": {
    "ano": 2026
  },
  "limit": 50
}
```

- `source` (obrigatório, `dict`): especificação idêntica a `layout.sources[i]`. Suporta tipos:
  - `"inline"`: dados manuais com `columns` e `rows`.
  - `"goals"`: metas mensais do relatório (`year`, `month`, `value`).
  - `"report"`: conjunto de dados nativo ou consulta SQL de outro relatório da mesma unidade.
  - `label` (opcional, string ≤ 60 chars): rótulo amigável no editor.
- `parameters` (opcional, `dict`): parâmetros para interpolação na consulta. Padrão: `{}`.
- `limit` (opcional, inteiro 1 a 500): limite de linhas a retornar na chave `rows`. Padrão: `50`.

#### Response Body (HTTP 200)

```json
{
  "columns": [
    {
      "name": "data",
      "type": "text",
      "looks_like": "date",
      "nullable": false,
      "null_count": 0,
      "sample": ["2026-10-01", "2026-10-02", "2026-10-03"]
    },
    {
      "name": "faturamento",
      "type": "number",
      "nullable": true,
      "null_count": 1,
      "sample": ["15200.5", "18400.0"]
    },
    {
      "name": "status",
      "type": "text",
      "nullable": false,
      "null_count": 0,
      "sample": ["concluido", "pendente"]
    }
  ],
  "rows": [
    ["2026-10-01", 15200.5, "concluido"],
    ["2026-10-02", 18400.0, "concluido"],
    ["2026-10-03", null, "pendente"]
  ],
  "total_rows": 3,
  "truncated": false,
  "elapsed_ms": 14
}
```

#### Regras de Inferência de Tipos (`type` e `looks_like`):
- `number`: valores Python `int`, `float`, `Decimal`.
- `date`: valores Python `datetime.date`.
- `datetime`: valores Python `datetime.datetime`.
- `boolean`: valores Python `bool`.
- `text`: valores string:
  - Se ≥ 90% dos valores não-nulos casam com padrão ISO `YYYY-MM-DD[THH:MM:SS]`: adiciona `"looks_like": "date"`.
  - Se ≥ 90% dos valores não-nulos casam com formato numérico: adiciona `"looks_like": "number"`.
- `unknown`: retornado quando a coluna não possui linhas ou possui apenas valores nulos.
- `sample`: até 3 valores distintos não nulos serializados como string.

---

### 2.2. Prévia Completa do Canvas (`POST /api/v1/reports/<id>/canvas-preview/`)

Gera o arquivo de exportação final (PDF ou XLSX) a partir do layout informado e parâmetros de teste, retornando o arquivo codificado em base64.

#### Request Body

```json
{
  "layout": { ... },
  "parameters": { ... },
  "output_format": "pdf"
}
```

- `output_format`: `"pdf"` ou `"xlsx"` (padrão `"pdf"`).

#### Response Body (HTTP 200)

```json
{
  "content": "JVBERi0xLjQK...",
  "format": "pdf",
  "rows": 120,
  "filename": "Relatorio_Faturamento.pdf"
}
```

---

### 2.3. Configuração do Canvas (`GET|POST /api/v1/reports/<id>/canvas/`)

- `GET`: Retorna o estado atual do relatório, incluindo `layout`, fontes disponíveis da unidade e lista de assets de imagem.
- `POST`: Salva a configuração do layout (`layout`, `output_format`, `enabled`).
  - Utiliza controle de concorrência otimista via campo `version`.
  - Rejeita com `409 Conflict` se `version` divergir.

---

### 2.4. Gestão de Imagens (`GET|POST /api/v1/reports/<id>/canvas-assets/`)

- `GET`: Lista as imagens do relatório (`id`, `filename`, `width`, `height`).
- `GET ?asset_id=<uuid>`: Retorna a imagem em base64.
- `POST`: Upload de nova imagem (PNG ou JPEG de até 2 MB, convertido internamente para PNG). Limite de 20 imagens por relatório.

---

## 3. Formato de Erros Estruturados

Em caso de erro de validação (HTTP 400), o backend retorna um objeto JSON estruturado:

```json
{
  "detail": "Gráfico \"Vendas\": a coluna \"Data\" não é uma data (valor \"abc\"). Escolha outra coluna ou remova o agrupamento.",
  "block_id": "chart_1",
  "source_id": "src_vendas",
  "code": "x_not_a_date"
}
```

### Compatibilidade com `frontend/src/api.ts`
O helper `request()` do frontend trata o erro como `new Error(data.detail)`. Portanto:
- O usuário visualiza imediatamente a mensagem acionável em pt-BR contida em `detail`.
- O editor de Canvas pode ler opcionalmente `block_id`, `source_id` e `code` para destacar visualmente o bloco ou campo com erro.

### Tabela de Códigos de Erro (`code`)

| Código | Significado | Campos Presentes |
|---|---|---|
| `x_not_a_date` | Coluna do eixo X não é data válida para agrupamento | `detail`, `block_id` |
| `series_not_numeric` | Coluna de série Y contém texto ou booleano para agregação numérica | `detail`, `block_id` |
| `series_count_invalid` | Quantidade de séries selecionadas fora do intervalo 1 a 6 | `detail`, `block_id` |
| `chart_points_limit` | Gráfico excede o limite de 500 pontos após agrupamento | `detail`, `block_id` |
| `pie_negative_value` | Gráfico de pizza recebeu valores negativos | `detail`, `block_id` |
| `x_field_required` | Bloco de gráfico sem coluna X selecionada na ativação/preview | `detail`, `block_id` |
| `y_fields_required` | Bloco de gráfico sem séries Y selecionadas na ativação/preview | `detail`, `block_id` |
| `value_field_required` | Bloco KPI sem coluna de valor selecionada na ativação/preview | `detail`, `block_id` |
| `column_not_found` | Coluna especificada não existe na fonte de dados | `detail`, `block_id` |
| `table_widths_mismatch` | Quantidade de larguras diverge da quantidade de colunas | `detail`, `block_id` |
| `source_required` | Bloco sem fonte vinculada ou endpoint chamado sem `source` | `detail`, `block_id` |
| `source_invalid` | Especificação de fonte corrompida ou duplicada | `detail`, `source_id` |
| `source_type_invalid` | Tipo de fonte desconhecido (não registrado em `SOURCES`) | `detail` |
| `source_label_invalid` | Rótulo da fonte excede 60 caracteres ou não é texto | `detail`, `source_id` |
| `source_not_found` | Fonte vinculada ao bloco não existe no layout | `detail`, `block_id`, `source_id` |
| `source_connection_failed` | Falha de conexão ou timeout ao ler a fonte | `detail`, `source_id` |
| `source_limit_exceeded` | Fonte retornou mais de 30.000 linhas | `detail`, `source_id` |
| `source_size_exceeded` | Fonte gerou mais de 10 MB de dados brutos | `detail`, `source_id` |
| `block_out_of_bounds` | Bloco posicionado fora dos limites da página | `detail`, `block_id` |
| `preview_failed` | Erro inesperado ao gerar a prévia do relatório | `detail` |

---

## 4. Extensões Retrocompatíveis de Gráfico (`options`)

Os blocos de gráfico (`line`, `bar`, `pie`) suportam novas propriedades em `options`. Se omitidas, o comportamento legado permanece idêntico:

### 4.1. `x_group`
Permite agrupar séries por períodos de data.
- **Valores permitidos:** `"day"` | `"week"` | `"month"` | `"quarter"` | `"year"`
- **Tipos aceitos no eixo X:** `date`, `datetime` ou `string` ISO (`YYYY-MM-DD` ou `YYYY-MM-DDTHH:MM:SS`).
- **Valores nulos em X:** são ignorados silenciosamente (não geram pontos no gráfico).
- **Semana:** inicia sempre na segunda-feira.
- **Rótulos formatados (pt-BR):**
  - `"day"`: `DD/MM/YYYY` (ex.: `27/10/2026`)
  - `"week"`: `sem. DD/MM` correspondente à segunda-feira (ex.: `sem. 26/10`)
  - `"month"`: `mmm/YY` minúsculo (ex.: `out/26`, `nov/26`, `jan/27`)
  - `"quarter"`: `T<Q>/YY` (ex.: `T4/26`, `T1/27`)
  - `"year"`: `YYYY` (ex.: `2026`)
- **Limite de 500 pontos:** É avaliado **após** o agrupamento. Fontes com milhares de registros agrupados em 12 meses passam normalmente.

### 4.2. `y_aggregate`
Define o cálculo agregado aplicado às séries numéricas do grupo.
- **Valores permitidos:** `"sum"` | `"avg"` | `"count"` | `"min"` | `"max"`
- **Padrão quando `x_group` está presente:** `"sum"`.
- **Efeito:**
  - Atua quando `x_group` está definido.
  - Atua também quando `x_group` está ausente sobre eixo X categórico repetido, consolidando as categorias e preservando a ordem da primeira aparição.
  - `"count"` aceita qualquer tipo de coluna; `"sum"`, `"avg"`, `"min"`, `"max"` exigem colunas numéricas.

### 4.3. `series_colors`
Lista de até 6 cores hexadecimais (`#rrggbb`) para personalizar as séries do gráfico.
- Se omitido: preserva a paleta legada do PDF (`PALETTE` em `pdf.py`).
- Se presente: substitui a paleta legada no PDF e no preview do editor. O XLSX usa o estilo nativo da planilha; personalização de suas cores ainda está pendente.

---

## 5. Extensão de Fonte (`sources[i]`)

### 5.1. `label`
- Campo opcional em `sources[i]`: string de até 60 caracteres.
- Preservado no layout JSON para exibição amigável no editor de Canvas.
- Não afeta a exportação.

---

## 6. Verificação e staging

Não alterar runtime, credenciais ou serviços de produção para validar o Canvas.
O staging do painel compartilha a API/banco; use apenas leitura e Prévia, nunca
Salvar/ativar em relatório real. Suba somente `scripts/canvas-stage.sh up`.
Testes de escrita usam fixtures no banco de teste ou requests mockados.

```sh
scripts/canvas-check.sh
docker compose --profile test run --rm tests pytest -q -p no:cacheprovider tests/
```

A Tarefa 08 usa `scripts/canvas-stage-qa.cjs` em container Playwright próprio:
todas as chamadas API são interceptadas, sessão e layouts são sintéticos e
qualquer método diferente de GET é abortado. Isso verifica a UI do staging,
sem provar integração autenticada com dados reais.

## 7. Limites e endurecimento (Tarefa 08)

- Layout: 750.000 bytes de JSON compacto UTF-8, mesmo critério do contador do front.
  Não finitos são rejeitados; exceder retorna HTTP 400 com orientação para reduzir.
- Tabela manual: 100 colunas únicas (nomes até 100 caracteres), 2.000 linhas;
  sujeita também ao tamanho máximo do layout. Células de texto: até 2.000 caracteres.
- Prévia de fonte aplica validação de identificador, tipo, label e tamanho antes
  de consultar. JSON de tipos inválidos retorna 400, sem erro 500 por objeto não hashable.
- Não finitos retornados por fontes na serialização da prévia produzem
  `source_nonfinite_value` com mensagem acionável.
- Falha inesperada de conexão: `source_connection_failed`; mensagem e log não
  incluem o texto da exceção, consulta, linha ou credencial.
- Audit de prévia contém somente metadados (formato/contagens/tempo/ID da fonte),
  sem amostras, parâmetros, linhas ou arquivo exportado. Audit de **salvamento**
  continua contendo o layout, inclusive linhas manuais que fazem parte dele.
- Cache de prévia: somente memória, separado por unidade/relatório/especificação/
  parâmetros/limite, até 30 entradas; limpo ao sair do editor. Preferências locais
  de painéis continuam existindo; rascunhos não contêm cache de dados consultados.
- Agrupamento usa ISO válido, ignorando X nulo. Strings compactas, semanas ISO
  escritas como `2020-W53-4` e `DD/MM/YYYY` não fazem parte do contrato. Semana
  calculada sobre datas ISO começa segunda-feira; hora/fuso não muda o dia escrito.
- Overflow de agregação produz `series_not_numeric`. Média divide antes de somar
  para evitar overflow intermediário com valores grandes de mesmo sinal.
- `export_format` retornado dentro do layout e campos opcionais conhecidos são
  preservados no ciclo front normalizar/sanear; a API grava o formato solicitado.
  Ausência de `options`, `color`, `font_size`, `parameters` e extensões continua
  ausente; defaults de apresentação não são injetados na persistência.

Guia de uso: [CANVAS_EDITOR.md](CANVAS_EDITOR.md). Evidências e limitações:
[CANVAS_REDESIGN_NOTES.md](CANVAS_REDESIGN_NOTES.md).
