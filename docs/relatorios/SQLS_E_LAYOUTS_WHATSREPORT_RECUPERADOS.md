# WhatsReport — SQLs e layouts recuperados

Conferência documentada em **24/10/2026 19:40:14, horário de Brasília**.

## 1. Resultado

Foi confirmado acesso autenticado aos bancos Firebird do servidor **172.16.0.123:3050**, com a conta técnica `SCV_TECNICO` e papel `RDB$ADMIN`. A versão retornada pelo servidor é **Firebird 3.0.7**.

As extrações desta etapa usaram transações **READ ONLY / SNAPSHOT**, com abertura sem execução de triggers de banco e sem garbage collection pela conexão investigativa. Foram consultados cadastros e metadados; nenhuma procedure de negócio, relatório, sincronização, BAT ou macro foi executada. Nenhum objeto, dado, destinatário, permissão ou programação foi alterado no legado por esta extração.

O papel administrativo da conta não torna a conta restrita a leitura: a proteção desta investigação foi aplicada na abertura e nas transações. A senha não faz parte desta documentação nem dos arquivos de metadados preservados.

## 2. Bancos e responsabilidades

| Banco | Caminho no servidor .123 | Responsabilidade comprovada |
|---|---|---|
| BASE.FDB | `C:\WhatsReport\Servidor\BD\BASE.FDB` | Catálogo de relatórios, consultas, parâmetros, composição, layout, destinatários, permissões e programações |
| GLDADOS.FDB | `C:\WhatsReport\Servidor\BD\GLDADOS.FDB` | Cache hospitalar, cadastros operacionais auxiliares e procedures de cálculo |

A contagem de relações abaixo considera objetos de usuário e exclui as relações marcadas como sistema. Relações podem ser tabelas ou views.

| Metadado | BASE.FDB | GLDADOS.FDB |
|---|---:|---:|
| Relações | 74 | 500 |
| Campos | 884 | 8065 |
| Procedures | 6 | 43 |
| Triggers | 41 | 31 |

## 3. SQLs e código de cálculo

| Material recuperado ao vivo | Quantidade |
|---|---:|
| Cadastros em TBRELATORIO | 321 |
| Cadastros com COMANDO_VIEW preenchido | 95 |
| Cadastros com campo PROCEDIMENTO preenchido | 199 |
| Registros de parâmetros | 716 |
| Linhas de composição | 302 |
| Procedures de usuário no GLDADOS | 43 |
| Procedures com fonte textual | 32 |
| Procedures sem fonte textual | 11 |

Os 95 cadastros com texto SQL e os 199 com campo PROCEDIMENTO preenchido **não são categorias mutuamente exclusivas**. O campo PROCEDIMENTO também contém nomes de views e marcadores de operação, como SINCRONIZAR; não representa necessariamente uma chamada de procedure Firebird.

O SQL do relatório **1 — Estoque / entrada e saída de empréstimos** foi confirmado ao vivo com **7.615 caracteres**. Há também SQLs completos dos cadastros 16 (PACIENTES_DIA), 17 (LEITOS_SISTEMA), 57 (CIRURGIAS) e 60 (ATENDIMENTOS_PS).

### Limite das procedures principais

| Procedure | Fonte textual ao vivo | Material disponível |
|---|---|---|
| PROC_RESUMO_ATENDIMENTOS | Não | BLR compilado |
| PROC_ALTAS_ATE_AS_10 | Não | BLR compilado |
| PROC_EXAMES_POR_ATENDIMENTO | Não | BLR compilado |
| PROC_LEITOS_DISPONIVEIS | Sim | PSQL e BLR |

Ausência de fonte textual não impede localizar entradas, saídas e dependências. Entretanto, o BLR não equivale ao PSQL original: a reconstrução de fórmulas ainda exige análise e reconciliação. Nenhuma equivalência integral de cálculos é declarada apenas com base nessa extração.

## 4. Layouts confirmados ao vivo

| Tabela | Linhas extraídas | Conteúdo |
|---|---:|---|
| TBRELATORIO_CONFIGURACAO | 8846 | Bandas, campos, textos, fontes, posições, dimensões, máscaras, visibilidade e parentesco |
| TBRELATORIO_GRAFICO | 134 | Séries, campos de categoria e valor, tipo de gráfico, legendas e cores |
| TBRELATORIO_GRAFICO_CONFIG | 1360 | Propriedades específicas dos gráficos |
| TBRELATORIO_CORES | 1755 | Faixas, critérios, cores e cores de fonte |
| TBRELATORIO | 321 | Papel, orientação, dimensões, gráfico e referência à imagem de fundo |
| TBRELATORIO_MULTIPLOS | 302 | Relação entre pai e partes e ordem de apresentação |

Os **8.846 componentes** de configuração pertencem a **233 IDs de cadastro**. Isso não significa 233 relatórios finais completos: o conjunto inclui partes de composições, e os pais podem não ter componentes visuais próprios. Tampouco representa quantidade de páginas prontas.

### Relatórios prioritários

As contagens abaixo somam as configurações das partes diretamente cadastradas no pai. Para Estoque, usam o próprio relatório. “Séries” significa linhas em TBRELATORIO_GRAFICO, não quantidade de gráficos ou de páginas.

| ID legado | Relatório | Partes | Componentes de layout | Séries |
|---|---|---:|---:|---:|
| 1 | Estoque - entrada e saída de empréstimos | Relatório simples | 41 | 0 |
| 20 | Indicadores Informativos | 10 | 182 | 33 |
| 40 | Indicadores Médicos | 7 | 254 | 7 |
| 310 | Vidas Sansaúde | 2 | 26 | 6 |

### Ordem das composições

- **Indicadores Informativos (20):** 43 → 19 → 24 → 25 → 18 → 62 → 64 → 65 → 58 → 44.
- **Indicadores Médicos (40):** 45 → 54 → 63 → 42 → 51 → 68 → 46.
- **Vidas Sansaúde (310):** 271 → 308.

### Estoque: configuração recuperada

O cadastro 1 possui 41 componentes, papel A4 em retrato, sem séries de gráficos. O layout agrupa por fornecedor e apresenta tipo, data, código/descrição do produto, unidade, quantidade, estoque atual e localização, com subtotais e total geral.

A recuperação de seu layout e SQL não comprova que o cadastro correspondente no SCV esteja habilitado nem que esteja homologado em produção. O cadastro SCV `legacy123-1` é distinto do placeholder `legacy-stock`; não unificar nem apagar um deles sem comprovar equivalência.

## 5. Motor de montagem identificado

A investigação estática anterior identificou no executável **WhatsReport.exe**:

- **FortesReport Community Edition 4.0 / Delphi-VCL** para bandas e paginação.
- **TeeChart** para gráficos.
- **TRLPDFFilter** instanciado no formulário de relatório para exportação PDF.
- Formulários **TfrmCadRelatorios** e **TfrmCadLayout** para manutenção do cadastro e da apresentação.
- Composição de PDFs pelo **PDFtk**, comprovada no fluxo anteriormente examinado de Vidas Sansaúde.

O fluxo identificado é: definição e parâmetros → conexão/fonte → resultado → configuração Fortes/TeeChart → PDF de cada parte → composição na ordem cadastrada.

A presença e configuração desses componentes foram recuperadas. O corpo Pascal de todos os eventos não foi obtido; em particular, eventos de montagem de gráficos e ajustes em tempo de execução ainda podem influenciar o resultado visual.

## 6. Imagens preservadas

As imagens abaixo foram copiadas em investigação anterior e tiveram sua existência e integridade conferidas nesta documentação. Não foram novamente baixadas do .123 nesta etapa.

| Imagem | Origem registrada | Estado |
|---|---|---|
| cabecalho.jpeg | `C:\WhatsReport\cabecalho.jpeg` | Arquivo preservado; SHA-256 confere |
| rodape.jpeg | `C:\WhatsReport\rodape.jpeg` | Arquivo preservado; SHA-256 confere |
| 62_FUNDO_GRAFICO.JPG | `C:\WHATSREPORT\IMAGENS\62_FUNDO_GRAFICO.JPG` | Arquivo preservado; SHA-256 confere |

Não afirmar que todas as artes estão recuperadas. Há referências a outros arquivos, como `logomarca.bmp` no Estoque e `58_FUNDO_GRAFICO.JPG` em gráficos de cirurgias, que não estão entre essas três imagens confirmadas. Uma referência no cadastro não prova que o arquivo existe ou que já foi copiado.

## 7. O que podemos reconstruir e o que exige validação

**Material recuperado:** estrutura visual cadastrada, campos e máscaras, fontes e posições, papel/orientação, séries/cores, ordem de composição, consultas disponíveis, parâmetros e fontes textuais de 32 procedures.

**Pendências para equivalência fiel:**

1. Conferir e preservar as demais imagens efetivamente utilizadas.
2. Reconstruir a lógica das procedures sem PSQL textual, quando necessária ao relatório.
3. Resolver diferenças de comportamento dos eventos do aplicativo.
4. Renderizar as partes e comparar visualmente com PDFs originais de referência.
5. Reconciliar números com a mesma base, período, filtros e fotografia de dados.
6. Distinguir homologação de produção antes de habilitar recebimento.

Layouts de relatórios internos não explicam, por si só, documentos cadastrados como arquivo externo da Controladoria. Nesses casos, o WhatsReport pode somente distribuir um PDF produzido fora dele.

## 8. Evidências preservadas no servidor SCV

### Extração ao vivo desta sessão

Raiz: `/opt/backups/orbita/whatsreport-sql-live-20261024/`.

- `definitions.json`: SQLs, definições, parâmetros, composição e fontes/BLR das procedures.
- `layouts.json`: componentes visuais, séries, propriedades, cores, papel e composição.
- `report_sql/report_<ID>.sql`: textos SQL dos 95 cadastros com COMANDO_VIEW preenchido.
- `procedure_sources/<NOME>.psql.txt`: código textual disponível.
- `compiled_blr/<NOME>.blr`: código compilado preservado, sem execução.
- `summary.json`: contagens da extração de SQLs/procedures.
- `sha256.json`: hashes dos arquivos de evidência.

Estrutura de banco: `/opt/backups/orbita/whatsreport-live-structure-20261024/structure.json` e `gldados_structure.json`.

### Evidência estática anterior

Raiz: `/opt/backups/orbita/reports-catalog-20261022/gerador-original-20261023/`.

- `GERADOR_ORIGINAL_PDFS.md`: comprovações do motor, formulários e montagem.
- `embedded_forms.json`, `frmRelatorio.dfm.json`, `frmGrafico.dfm.json`: formulários preservados.
- `assets_manifest.json` e `assets/`: imagens e hashes.
- `layouts.json`, `report_*_layout.json`: fotografia anterior dos layouts, distinta da extração ao vivo desta sessão.

Os arquivos são evidências privadas de investigação no SCV; não devem ser publicados indiscriminadamente. Esta documentação não inclui credenciais nem registros de pacientes.

## 9. Continuidade

Usar a extração ao vivo para localizar SQL e layout por **ID legado**, mantendo o vínculo com código e unidade no SCV. Composição e nome do PDF devem ser conferidos antes de associar documentos com nomes parecidos.

Para uma nova investigação no legado: conta autorizada, conexão sem triggers de banco quando permitido e transação READ ONLY. Não executar procedures desconhecidas, ainda que sejam chamadas por SELECT. Salvar novas evidências no SCV, nunca gravar scripts ou arquivos de investigação no .123.
