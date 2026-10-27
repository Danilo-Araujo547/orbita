# Indicadores Informativos — mapeamento técnico

Conferência em 24/10/2026 (Brasília). Escopo: mapear o cadastro, as fontes, as regras e a montagem para futura migração ao SCV Messenger. Não é implementação nem aceite de equivalência integral.

## 1. Identidade confirmada

- Legado: cadastro 20, nome COMPLETO TAXA OCUPAÇÃO, descrição INDICADORES INFORMATIVOS, NOME_PDF = INDICADORES_INFORMATIVOS.
- SCV: unidade scv, ID 33, código legacy123-20, versão 1; fonte composite; enabled=False; reviewed=False; handler vazio, na leitura desta tarefa.
- A ordem dos dez componentes no SCV coincide com TBRELATORIO_MULTIPLOS do legado.
- O relatório 55 é uma variante distinta: não substituir o cadastro 20 por ele.
- Evidências legadas são fotografias coletadas em 22–23/10; esta tarefa fez análise offline no servidor SCV e leitura do cadastro SCV. Não houve nova inspeção ao vivo no Windows .123.

## 2. Software de cadastro no .123

**WhatsReport:** C:\WhatsReport\WhatsReport.exe. O executável preservado contém os formulários TfrmCadRelatorios e TfrmCadLayout. Cadastro de relatórios, parâmetros, composição, layout, séries e cores ficam no BASE.FDB. Formulários-base e componentes de exportação PDF foram recuperados sem executar o programa.

**G4:** há evidência distinta de cadastro manual da capacidade de leitos. A fonte textual de PROC_LEITOS_DISPONIVEIS declara: “a tabela CADASTRO_LEITOS e alimentada manualmente no cadastro de leitos no G4”. Existe uma cópia de G4light.exe nas evidências de Vidas Sansaúde e executáveis G4LightWEB no manifesto da pasta WhatsReport. A vinculação do menu/tela exata e da versão do executável ao cadastro de leitos ainda não foi demonstrada pela inspeção estática. Não afirmar que o G4LightWEB específico é o mantenedor apenas por estar instalado.

São dois usos diferentes que ajudam na migração: WhatsReport define como o documento é montado; o cadastro de leitos do G4 fornece uma regra operacional que interfere nos números.

## 3. Bancos e fluxo

- BASE.FDB: C:\WhatsReport\Servidor\BD\BASE.FDB, no .123. Catálogo e parâmetros da aplicação.
- GLDADOS.FDB: C:\WhatsReport\Servidor\BD\GLDADOS.FDB, base legada 3, .123:3050. Cache hospitalar, cadastros auxiliares e apuração.
- Oracle de origem: base legada 1, 172.16.0.254:1521/prdvotu. Identificado pelo cadastro e pelos SQLs preservados; esta tarefa não consultou esse banco.

Fluxo de ocupação:

Oracle MOV_INT/ATENDIME/LEITO/UNID_INT/CONVENIO → sincronizador 16 → PACIENTES_DIA.

Oracle LEITO/UNID_INT → sincronizador 17 → LEITOS_SISTEMA + CADASTRO_LEITOS manual do G4 → rotina 23 / PROC_LEITOS_DISPONIVEIS → LEITOS_DISPONIVEIS.

PACIENTES_DIA + LEITOS_DISPONIVEIS + CADASTRO_SETORES → PROC_RESUMO_ATENDIMENTOS → componentes 19/24/25/18.

Fluxo de atendimentos e cirurgias:

Oracle ATENDIME e cadastros relacionados → sincronizador 60 → ATENDIMENTOS_PS → procedure tipo 7 → componente 62.

Oracle AVISO_CIRURGIA/CIRURGIA_AVISO/CIRURGIA e relacionados → sincronizador 57 → CIRURGIAS → procedure tipos 20/21/6 → componentes 64/65/58.

No legado, grupo 61 reúne preparação/limpeza, leitos, leitos disponíveis e pacientes-dia. Grupo 59 contém as cargas de atendimentos/cirurgias. Nenhuma dessas rotinas foi executada nesta tarefa.

## 4. Composição em ordem

| Ordem | ID legado / código SCV | Conteúdo | Origem/chamada cadastrada |
|---|---|---|---|
| 1 | 43 / legacy123-43 | Cabeçalho | `SELECT NOMCLI FROM CADCLI` |
| 2 | 19 / legacy123-19 | Paciente-dia e ocupação geral | `PROC_RESUMO_ATENDIMENTOS(1, TODOS, 19, SERIES1)` |
| 3 | 24 / legacy123-24 | Paciente-dia e ocupação SUS | `PROC_RESUMO_ATENDIMENTOS(1, SUS, 24, SERIES1)` |
| 4 | 25 / legacy123-25 | Paciente-dia e ocupação convênio | `PROC_RESUMO_ATENDIMENTOS(1, CONVENIO, 25, SERIES1)` |
| 5 | 18 / legacy123-18 | Ocupação por setor | `PROC_RESUMO_ATENDIMENTOS(2, TODOS, 18, SERIES1)` |
| 6 | 62 / legacy123-62 | Média de atendimentos por tipo de entrada | `PROC_ALTAS_ATE_AS_10(7, 62, SERIES1)` |
| 7 | 64 / legacy123-64 | Média de cirurgias eletivas | `PROC_ALTAS_ATE_AS_10(20, 64, SERIES1)` |
| 8 | 65 / legacy123-65 | Média de cirurgias urgência/emergência | `PROC_ALTAS_ATE_AS_10(21, 65, SERIES1)` |
| 9 | 58 / legacy123-58 | Média total de cirurgias | `PROC_ALTAS_ATE_AS_10(6, 58, SERIES1)` |
| 10 | 44 / legacy123-44 | Encerramento/rodapé | `SELECT NOMCLI FROM CADCLI` |

Os argumentos acima representam os valores e a ordem cadastrados, não comandos para execução. As strings foram abreviadas sem aspas SQL para legibilidade.

## 5. Regras de ocupação recuperadas

### Paciente-dia

O SQL 16 produz dados por unidade de internação, categoria de convênio e dia. Fórmula explícita na consulta:

`paciente_dia = internados_00h + entradas_internacao + entradas_transferencia - altas - saidas_transferencia - obitos`.

O SQL também coleta hospital-dia, óbitos no dia e óbitos em 24/48h. Esses campos não devem ser somados à fórmula acima sem analisar o uso de cada ramo.

Filtros recorrentes: empresa 1; unidade de internação tipo I; hospital-dia não; atendimento pai nulo; tipos I/H/U em ramos da consulta. Movimentos, altas, transferências e óbitos têm condições próprias em cada UNION. O SQL completo foi preservado; a lista resumida não substitui seus joins e exceções.

Convênios nesta fonte usam CONVENIO.TP_CONVENIO: C → CONVENIO, P → PARTICULAR, A/H → SUS. Esta classificação é diferente do CASE por código numérico usado nas cirurgias.

A série de dias do SQL original começa em 01/01/2021 e vai até ontem; usa DBAMV.CID como gerador de linhas. Para migração, parametrizar o período e validar a quantidade de dias, sem transportar automaticamente esse gerador para uma nova implementação.

### Capacidade total e separação SUS/convênio

SQL 17: conta LEITO por UNID_INT, TP_SITUACAO='A', SN_EXTRA='N', TP_OCUPACAO em O/V/R/L, excluindo unidades 11/12/17. A data coletada é SYSDATE. Essa consulta representa a posição atual; não reconstrói capacidade passada.

Fonte textual recuperada de PROC_LEITOS_DISPONIVEIS:

1. Seleciona LEITOS_SISTEMA com DATA exatamente igual a WPA_DATA_INICIAL.
2. Soma CADASTRO_LEITOS por DS_UNID_INT: total, SUS e CONVENIO.
3. Inicia proporcao_SUS=1; se total cadastrado > 0, usa cadastrado_SUS / cadastrado_total.
4. `leitos_SUS = TRUNC(leitos_sistema * proporcao_SUS)`.
5. `leitos_convenio = leitos_sistema - leitos_SUS`.
6. Grava por nome de setor, convênio e data usando UPDATE OR INSERT.

O corpo recuperado não usa WPA_DATA_FINAL. O relacionamento usa nome do setor, não apenas seu código. Total ausente/nulo e cadastro SUS ausente devem ser tratados conforme a semântica real do Firebird antes de qualquer portabilidade; a inicialização em 1 não significa que todos os casos de nulo produzam 100% SUS.

Para eliminar Firebird, será necessário preservar esse cadastro operacional e seu histórico/vigência, além dos snapshots de capacidade. Não substituir a proporção manual por uma proporção inferida dos pacientes atendidos.

### Média e taxa

Nos ramos examinados do BLR de PROC_RESUMO_ATENDIMENTOS:

- P = soma CVU_PAC_DIA; L = soma QUANTIDADE em LEITOS_DISPONIVEIS; D = DATEDIFF de dias + 1.
- Média de pacientes = ROUND(P / D, 0).
- Média de leitos = ROUND(L / D, 0).
- Ocupação = ROUND(100 * média_pacientes / média_leitos, 0), quando o denominador é positivo.
- O ramo geral inclui CONVENIO, SUS e PARTICULAR.
- O ramo SUS filtra SUS.
- O ramo CONVENIO/PARTICULAR reúne CONVENIO e PARTICULAR nas consultas examinadas.

Não substituir por razão direta dos totais: o arredondamento intermediário pode mudar o percentual. O tratamento legado deixa taxa zero quando o denominador não é positivo; a validação anterior documentou falta de capacidade com pacientes existentes, mascarada como 0%. Para o novo SCV, propõe-se distinguir ausência de capacidade de ocupação zero. Essa mudança precisa ser explícita e validada, sem alterar o legado nesta etapa.

PROC_RESUMO_ATENDIMENTOS também modifica campos temporários de CADASTRO_SETORES no BLR recuperado. Apesar de ser chamada em SELECT pelo aplicativo, não é uma consulta puramente de leitura.

## 6. Atendimentos e cirurgias

### Atendimentos — componente 62

SQL 60 agrupa por competência, data, tipo de atendimento, origem, cidade e convênio; retorna COUNT(*) em CONTOU. Filtra empresa 1, atendimento pai nulo, início fixo em 01/01/2023 e fim em ontem. O título ATENDIMENTOS_PS não prova por si só filtro exclusivo de urgência: o SQL de carga inclui diferentes tipos.

No ramo tipo 7, o BLR soma CONTOU por DS_ORI_ATE e período e separa cinco origens textuais:

- RECEPCAO PS - CONVENIO.
- RECEPCAO PS - SUS.
- RECEPCAO PA - G.O.
- RECEPCAO PA - PEDIATRIA.
- RECEPCAO PS - ISOLAMENTO.

Há médias arredondadas para inteiro no trecho anual examinado e total como soma das cinco séries já calculadas. Nomes de origem, precisão das outras janelas e dias do denominador precisam ser reconciliados por ramo; não usar a média de todas as origens como substituição.

### Cirurgias — componentes 64, 65 e 58

SQL 57 seleciona DISTINCT aviso, competência, dia de realização, centro cirúrgico, grupo de convênio e TP_CIRURGIAS. Joins incluem ATENDIME, AVISO_CIRURGIA, CIRURGIA_AVISO, CIRURGIA, CONVENIO, EMPRESA_CONVENIO, PACIENTE, ESPECIALID, CIDADE e TIP_ANEST.

Filtros explícitos: empresa 1 no atendimento e EMPRESA_CONVENIO; aviso realizado (TP_SITUACAO='R'); realização entre 01/01/2023 e ontem. O DISTINCT é sobre todas as colunas selecionadas; não assumir um único registro por aviso antes de avaliar múltiplos convênios/classificações.

Grupos de convênio: códigos 1/2 → SUS; 43 → PARTICULAR; 37 → SANSAUDE; 30 → IAMSPE; demais → CONVENIO.

BLR dos ramos anuais inspecionados:

| Tipo | Regra adicional |
|---|---|
| 6 / total | CENTRO_CIRURGICO = 1, sem filtro de TP_CIRURGIAS no trecho examinado |
| 20 / eletivas | CENTRO_CIRURGICO = 1 e TP_CIRURGIAS = E |
| 21 / urgência/emergência | CENTRO_CIRURGICO = 1 e TP_CIRURGIAS em U/M |

As consultas agrupam por convênio e contam registros do cache. Há divisão pelos dias e ROUND para uma casa no trecho anual de cirurgia examinado. Para anos anteriores há constante 365 no BLR; o ano corrente usa DATEDIFF + 1 no trecho examinado. Não trocar silenciosamente por 366 em ano bissexto numa reprodução fiel; registrar separadamente eventual correção desejada. Precisão mensal/diária, totalização e todos os cortes ainda exigem transcrição e reconciliação completas.

As séries de gráfico são SUS, Sansaúde, Convênio, Particular, Iamspe e Total. “Total = eletivas + urgência/emergência” não é garantido apenas pelo título: o ramo total não tem a mesma restrição de tipo no trecho examinado.

## 7. Layout e montagem

- Motor: FortesReport Community Edition 4.0, Delphi/VCL; gráficos TeeChart; exportação TRLPDFFilter.
- Composição final do aplicativo usa PDFtk; a ordem do relatório 20 está comprovada em TBRELATORIO_MULTIPLOS. Não foi executado o comando específico desse relatório nesta tarefa.
- TBRELATORIO_CONFIGURACAO: bandas, títulos, campos, fontes, dimensões e visibilidade.
- TBRELATORIO_GRAFICO e TBRELATORIO_GRAFICO_CONFIG: séries e propriedades.
- TBRELATORIO_CORES: faixas e critérios.
- Cabeçalho 43 referencia cabecalho.jpeg; encerramento 44 referencia rodape.jpeg. Ambos usam SELECT NOMCLI FROM CADCLI; isso não é a origem dos indicadores.
- Ocupação geral/SUS/convênio: séries RET_MES1 (barras), RET_MES2 (linha), RET_MES3 (barras), com categoria RET_NOME_SETOR. O significado dos campos é definido pela procedure, não pelo nome MES1 isoladamente.
- Ocupação por setor: layout traz “Últimos 12 meses”, “Últimos 8 dias”, “Atual”, “Leitos” e “Setor”. A procedure possui 13 campos mensais e oito diários; títulos visuais não bastam para deduzir todos os períodos.
- Atendimentos/cirurgias: seis séries; campos RET_MES1 a RET_MES6 usados para as categorias da página. Background cadastrado 62_FUNDO_GRAFICO.JPG para atendimentos e 58_FUNDO_GRAFICO.JPG para cirurgias. A existência de todas as imagens ainda deve ser conferida antes de renderizar.
- Os componentes usam papéis personalizados e orientação paisagem. Não impor A4 ao conjunto apenas porque o cadastro pai declara A4.
- Código Pascal de eventos não foi recuperado. Configuração extraída não prova equivalência visual integral.

## 8. Estado da evidência e pendências

| Tema | Comprovado | Ainda necessário |
|---|---|---|
| Identificação | Cadastro 20, descrição/nome do PDF, ordem das dez partes | — |
| Cadastro visual | Formulários do WhatsReport e tabelas de configuração | Verificação visual no aplicativo, se necessária |
| Capacidade SUS/convênio | Dependência manual G4 e regra textual de rateio | Identificar tela/versão exata; recuperar cadastro e vigências aprovados |
| Fontes Oracle | SQLs 16/17/57/60 preservados | Resolver schemas/sinônimos e validar mesmos filtros/base/período |
| Ocupação | Fórmula e arredondamentos; validação anterior de 40 pontos diários em cinco setores | Todas as janelas/setores e tratamento explícito de lacunas |
| Atendimentos/cirurgias | Fontes, séries, tipos, filtros e trechos de cálculo | Transcrição integral por janela e reconciliação numérica |
| Histórico | Necessidade de capacidade por data e rateio operacional | Cobertura histórica e lacunas; não reconstruir passado com cadastro atual |
| Apresentação | Configurações e ordem recuperadas | Artes faltantes, render e comparação ao PDF de referência |
| SCV | Cadastro existente, bloqueado e sem handler | Implementação, testes isolados, homologação e aceite |

O PSQL original de PROC_RESUMO_ATENDIMENTOS e PROC_ALTAS_ATE_AS_10 não está disponível nas evidências examinadas. O BLR compilado e seus literais foram examinados offline; isso não equivale a recuperar o código original nem valida os resultados por si só.

A validação anterior de 40 percentuais tem escopo limitado a cinco setores e oito dias e foi relatada em docs/VALIDACAO_CALCULOS_RELATORIOS.md. Esta tarefa não refez os cálculos contra bases hospitalares.

## 9. Sequência recomendada para implementar

1. Recuperar os dados administrativos de CADASTRO_LEITOS/CADASTRO_SETORES por leitura autorizada, conferir vínculo com o G4 e identificar regras de manutenção/vigência.
2. Definir data de referência e janelas; transcrever os ramos relevantes do BLR com suas exceções, totalização e arredondamentos.
3. Reutilizar snapshots de capacidade já implementados no SCV, preservando homologação/produção e lacunas históricas; incorporar o rateio aprovado sem inferir o passado.
4. Preparar consultas Oracle parametrizadas e agregadas, somente leitura, com limites e amostras do mesmo ambiente e período do PDF de comparação.
5. Renderizar as dez partes, reconciliar números e layout; testar autorização, versão, idempotência e transporte simulado.
6. Somente após validação, configurar o relatório no SCV e solicitar aceite operacional. Nenhuma autorização de envio/programação foi concedida por este mapeamento.

## 10. Evidências e rastreabilidade

Raiz histórica: /opt/backups/orbita/reports-catalog-20261022/.

- legacy/BASE_catalog.json: identidade, descrição e fonte.
- legacy/all_definitions.json: SQLs e parâmetros.
- legacy/legacy_procedure_metadata_all.json: parâmetros/dependências e fonte textual de leitos disponíveis.
- gerador-original-20261023/layouts.json e report_20_layout.json: layout, séries, composição e papel.
- gerador-original-20261023/embedded_forms.json e GERADOR_ORIGINAL_PDFS.md: software e geração.
- gerador-original-20261023/files.json e vidas-sansaude-20261023/g4_files.json: executáveis encontrados nas fotografias.
- origens-pendentes-20261023/*.blr.readable.txt: estrutura compilada das duas procedures.
- origens-pendentes-20261023/RASTREAMENTO_QUATRO_RELATORIOS.md: rastreamento anterior.
- validacao-calculos-20261023/PROC_LEITOS_DISPONIVEIS.sql e docs/VALIDACAO_CALCULOS_RELATORIOS.md: rateio manual e validação anterior.

Evidências selecionadas desta tarefa: /opt/backups/orbita/indicadores-informativos-mapeamento-20261024T163728Z/.

Incluem SQLs selecionados, parâmetros, layouts, mapa em JSON, metadados sem BLR binário, fonte de leitos disponíveis e literais de BLR decodificados com referência às linhas originais. Nenhuma consulta extraída foi executada. O arquivo sha256.json registra integridade dos artefatos da tarefa; não prova atualidade dos dados originais.

Não foram feitas alterações no legado, nas definições operacionais, nos canais, nas permissões ou nas programações. O único arquivo novo no projeto é este documento; os demais artefatos estão no diretório de evidências.
