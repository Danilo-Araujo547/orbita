# SCV Messenger — passagem técnica dos relatórios para outra LLM

Atualizado em **24/10/2026**, horário de Brasília. Documento para continuar a implementação dos relatórios e a investigação do legado. Distingue cadastro, implementação, validação e pendências. Não contém credenciais ou dados de pacientes.

## 1. Instruções obrigatórias para a próxima LLM

1. Trabalhar exclusivamente em **root@172.16.0.59**, projeto **/opt/orbita**. Ler `/opt/orbita/AGENTS.md` antes de editar. A autenticação SSH por chave já funcionava na máquina do usuário; se não estiver disponível na nova sessão, pedir acesso ao administrador. Não redefinir senhas nem copiar chaves indiscriminadamente.
2. Não sincronizar o projeto com um checkout local. A decisão do usuário é trabalhar no remoto. Documentos e PDFs podem ser baixados como entregáveis.
3. Existem muitas alterações locais ainda não consolidadas em commits. Conferir `git status --short`; não usar reset, clean, checkout ou substituir pastas para recuperar uma versão antiga.
4. **Servidores legados e bancos hospitalares são somente leitura.** Não gravar scripts, arquivos de investigação, agendamentos ou dados nesses hosts. Salvar evidências em `/opt/backups/orbita/` no SCV.
5. Não executar BATs, macros, sincronizadores, limpezas ou procedures desconhecidas. Mesmo SELECT de procedure Firebird pode alterar dados.
6. Não habilitar programações nem fazer disparos reais para validar código. O canal manual da unidade SCV está ativo e atende usuários reais. Testes devem usar dados fictícios, mocks e transporte desativado.
7. Preservar login customizado, configurações criptografadas, chaves, sessões e permissões existentes. Não remover controles de unidade, versão, idempotência ou autorização.
8. Não tratar conexão cadastrada como fonte comprovada. Existem placeholders de conexões Firebird antigas cadastrados como destino futuro Oracle. Não afirmar DBLINK sem evidência.
9. Não confundir homologação com produção. Não comparar PDFs de bases ou períodos diferentes para concluir erro de fórmula.
10. Nunca colocar credenciais, chaves privadas, tokens ou conteúdo identificável de pacientes em logs, commits ou documentos de passagem.

## 2. Acesso ao sistema e organização do servidor

| Recurso | Localização |
|---|---|
| Painel | `http://172.16.0.59:8080/` |
| Relatórios SCV | `http://172.16.0.59:8080/relatorios?unit=scv&reportTab=reports` |
| WhatsApp / QR Code | mesma rota, `reportTab=whatsapp` |
| Componentes | mesma rota, `reportTab=components` |
| Destinatários e permissões manuais | mesma rota, `reportTab=recipients` |
| Programações | mesma rota, `reportTab=automations` |
| Execuções e download | mesma rota, `reportTab=executions` |
| Django admin | `/admin/`, com autenticação administrativa |
| Backend Django/DRF | `/opt/orbita/backend` |
| Frontend React/TypeScript/Vite | `/opt/orbita/frontend` |
| Transporte Node/Baileys | `/opt/orbita/baileys` |
| Docker Compose | `/opt/orbita/compose.yaml` |
| Documentação | `/opt/orbita/docs/` |
| Evidências legadas | `/opt/backups/orbita/reports-catalog-20261022/` |

Serviços Compose: `db`, `redis`, `api`, `worker`, `scheduler`, `panel`, `baileys` e perfil `tests`. Containers correntes: `orbita-api-1`, `orbita-worker-1`, `orbita-scheduler-1`, `orbita-panel-1`, `orbita-baileys-1`. O banco operacional é PostgreSQL. SQLite existe para fontes simuladas e armazenamento interno do transporte, não como banco principal.

Conta administrativa de aplicação identificada como `admin`; a senha deve ser fornecida pela operação, não consta deste documento.

### Credenciais

- `.env`, configurações criptografadas e diretório `secrets` pertencem à operação. Não despejar seus conteúdos no chat.
- `ReportConnection.ciphertext` armazena o segredo criptografado. O mecanismo está em `report_engine.py` e `core/oracle_credentials.py`. Não substituir a chave de criptografia: isso pode inutilizar conexões existentes.
- Para testar uma conexão já cadastrada, usar `operations.report_engine.connect()`, recuperando o segredo somente em memória e estabelecendo transação de leitura.
- A conexão médica de homologação é a **19**. Não é necessário copiar sua senha para um script.
- Se a LLM não tiver acesso, pedir ao administrador. Não reutilizar credenciais de um banco para outro nem adivinhar senhas.

## 3. Estado atual confirmado

| Unidade | Slug | Relatórios finais | Componentes |
|---|---|---:|---:|
| SCV | scv | 137 | 199 |
| AME Votuporanga | ame | 9 | 0 |
| Sansaúde | sansaude | 9 | 0 |
| **Total** | | **155** | **199** |

Total: **354 cadastros**, na conferência de 24/10/2026. Não usar os antigos totais 348, 141/194 ou 131/204 como inventário atual. O apêndice contém uma linha por cadastro vivo.

Canal WhatsApp na última conferência:

- SCV: envios e solicitações manuais habilitados; automáticos desabilitados.
- AME e Sansaúde: os três controles desabilitados.
- Nenhuma `ReportAutomation` habilitada.
- Baileys conferido conectado. Não apagar volume nem gerar uma nova sessão sem necessidade.
- Reconsultar esses estados antes de agir: são configurações editáveis pelo administrador.

### Relatórios prioritários

| Relatório / código | Estado real | Pendência |
|---|---|---|
| Indicadores Médicos — `legacy123-40`, ID 50 | Integrado ao SCV com Oracle de homologação; PDF completo validado. Solicitação manual WhatsApp liberada recentemente. | Aceite no aparelho e homologação específica em produção. |
| Exportar Tabela Leitos — `legacy123-311` | Integrado em homologação: snapshots PostgreSQL + XLSX; primeira coleta de 24/10 validada. | Homologar produção e importar o histórico legado identificado. |
| Vidas Sansaúde — `legacy123-310`, componentes 271/308 | Consulta Oracle de beneficiários executada; snapshots/metas legados mapeados. | Alimentação das metas e reprodução histórica sem Firebird. |
| Indicadores Informativos — `legacy123-20` | Composição de dez partes identificada. | Converter e validar rotinas/cálculos de todas as partes. |
| Indicadores Gerenciais — `legacy123-162` | PDF local integrado, handler `external_pdf_v1`, versão 2; geração e download validados. | Atualizar `/opt/orbita/files/reports/indicadores-gerenciais/indicadores-gerenciais.pdf`, autorizar destinatários e validar no aparelho. |
| Indicadores Estratégicos — `legacy123-163` | PDF local integrado, handler `external_pdf_v1`, versão 2; geração e download validados. | Atualizar `/opt/orbita/files/reports/indicadores-estrategicos/indicadores-estrategicos.pdf`, autorizar destinatários e validar no aparelho. |
| Painel Leitos — `legacy123-309` | PDF local integrado, handler `external_pdf_v1`, versão 2; 121 testes aprovados, sem disparos reais. | Publicar `/opt/orbita/files/reports/painel-leitos/painel-leitos.pdf`, autorizar destinatários e validar no aparelho. Geração do conteúdo permanece externa/manual. |

**Não confundir `legacy123-56`, também chamado INDICADORES MEDICOS, com o integrado `legacy123-40`.** O 56 é demonstração legada, desativada e não convertida.

## 4. Como cadastrar e manipular os relatórios

### Classificação

`ReportDefinition.catalog_kind` vale `report` ou `component`.

- Relatório é saída que pode ser recebida por solicitação manual ou programação, sujeita à prontidão e autorização.
- Componente é consulta, gráfico, tabela, cabeçalho, rodapé ou auxiliar sem envio independente.
- **Permissão de recebimento manual/automático é evidência prioritária de relatório**, mesmo que ele também participe de outra composição. Permissões legadas desativadas contam como evidência de finalidade, sem serem ativadas.
- Existem rotinas antigas com permissões. Permanecem em Relatórios conforme decisão do usuário, com bloqueios preservados. Classificação não autoriza executar limpeza ou sincronização.
- A antiga aba Revisar virou Componentes. `review_queue` permanece como bloqueio no banco, não como navegação atual.
- Componentes são administrativos, com prévia de leitura, e podem ser coletados pelo pai. Não recebem novas permissões/programações independentes.
- Mover para Componentes preserva SQL e disponibilidade interna, mas pausa programações próprias. Mover de volta não reativa envios.

### Modelos essenciais

| Modelo | Função |
|---|---|
| ReportDefinition | Unidade, código, fonte, SQL, conexão, parâmetros, componentes, handler, flags e versão. |
| ReportConnection | Destino, limites, validação e segredo criptografado. |
| ReportRecipient | Número/grupo, unidade, ativação, verificação e usuário opcional. |
| ReportGrant | Permissão por destinatário/relatório, modalidades, restrições e versão. |
| ReportAutomation | Calendário, parâmetros e destinatário. |
| ReportExecution | Geração, resultado, entrega e fotografia de definição/permissões. |
| ReportWhatsAppConfiguration | Canal por unidade, controles de envio e textos do fluxo. |
| ReportConversation | Estado temporário, parâmetros e validade. |
| ReportInboundReceipt | Deduplicação de recebimentos e ações de resposta. |

Também existem estruturas anteriores `ReportAccess`, `ReportRequest` e `ReportSchedule`, com endpoints compatíveis. Não apagá-las nem ignorá-las numa auditoria.

### Cadastro de consulta ou composição

1. Selecionar a unidade apenas no topo da barra lateral.
2. Usar Adicionar/Editar na aba apropriada; inputs somente em modal/formulário dedicado.
3. Escolher conexão da mesma unidade, cadastrar SELECT, parâmetros tipados e formato.
4. Fazer prévia técnica e reconciliar dados, período, filtros e fórmulas antes de marcar revisado/habilitado.
5. Composição referencia códigos dos componentes e parâmetros por parte. Componente pode estar disponível internamente sem ser solicitável sozinho.
6. Alterações exigem `version`. Erro 409 significa conflito: recarregar/reconciliar, não sobrescrever silenciosamente.
7. Ações e solicitações usam `Idempotency-Key`.

O executor limita SELECT a uma instrução, usa binds e limita tempo, linhas e tamanho. Não trocar isso por SQL concatenado recebido do WhatsApp. Consultas e procedures desconhecidas exigem investigação de efeitos antes de uso.

### Destinatários e permissões: interface atual

As permissões manuais estão no detalhe de **Destinatários**. Não há mais aba separada Permissões; `reportTab=grants` antigo é compatibilizado.

- Editar destinatário, conferir telefone/grupo, estado e verificação.
- Adicionar relatório abre busca em modal, com pelo menos dois caracteres e paginação.
- Salvar persiste destinatário/vínculos na mesma transação.
- Vínculos antigos inativos permanecem inativos; salvar não verifica nem ativa um novo número.
- Remover manual não deve revogar automaticamente a modalidade automática, seus parâmetros ou histórico.
- Editor Avançado preserva restrições e controles por relatório.
- Identidades duplicadas/ambíguas não combinam permissões automaticamente.

Ler `docs/relatorios/PERMISSOES_MANUAIS_POR_DESTINATARIO.md` e `backend/operations/recipient_manual_reports.py` antes de alterar essa parte.

## 5. APIs e arquivos de implementação

APIs do painel: `/api/v1/`, autenticadas e com escopo `?unit=scv`, `ame` ou `sansaude`.

| Endpoint | Uso |
|---|---|
| GET `reports/?section=reports` | Saídas finais; lista padrão. |
| GET `reports/?section=components` | Componentes, administração. |
| GET `reports/{id}/` | Definição e auditoria dos parâmetros. |
| POST `reports/{id}/configure/` | Alteração com versão. |
| POST `reports/{id}/preview/` | Prévia de SELECT revisado. |
| GET `reports/inventory/` | Contagens. |
| `report-connections/` | Conexões, com ação `/test/`. |
| `report-recipients/` | Destinatários, verificação e seleção manual. |
| GET `report-recipients/{id}/manual-reports/` | Seleção, inativos e token de concorrência. |
| GET `report-recipients/manual-report-options/?search=...` | Busca paginada dos relatórios para cadastro. |
| `report-grants/` | API avançada de permissão por relatório. |
| `report-automations/` | Programações, manter desativadas sem autorização. |
| POST `report-executions/` | Geração: report, parameters, destinatário opcional. |
| GET `report-executions/{uuid}/download/` | Download com revalidação de autorização/versões. |
| GET/POST `report-whatsapp/` | Status, QR e configuração de canal/fluxo. |
| POST `report-whatsapp/inbound/` | Callback privado autenticado por token. |
| POST `report-whatsapp/authorize/` | Autorização privada antes da transmissão. |

Adicionar `unit` às chamadas do painel. ID não substitui autorização. Nunca expor token de serviço ao navegador.

Arquivos backend em `backend/operations/`:

- `models.py`: persistência.
- `report_api.py`: administração, filtros, serializers, ações e download.
- `report_engine.py`: conexão, segredo, binds, SELECT limitado e render genérico.
- `reporting.py`: prontidão, autorização, composição, geração e agendamento.
- `reports.py`: saídas operacionais nativas do SCV.
- `report_whatsapp.py`: conversa, parâmetros, menu, autorização e entrega.
- `report_parameters.py`: normalização/auditoria de parâmetros.
- `medical_indicators.py`: extração e execução médica Oracle.
- `medical_layout.py`: montagem do PDF médico.
- `recipient_manual_reports.py`: seleção manual por destinatário.

Frontend: `ReportWorkspace.tsx`, `ReportWhatsApp.tsx`, `ReportParameterPrompts.tsx`, em `frontend/src/components/`, e `frontend/src/format.ts`.

Transporte: `baileys/server.mjs`, `interactive.mjs`, `store.mjs`.

Migrations relevantes: 0015 catálogo/conexões; 0019 revisão; 0020 canal; 0021 classificação; 0022 prioridade das permissões; 0023 textos do fluxo.

## 6. Fluxo WhatsApp atual

1. Baileys recebe e armazena inbox criptografada por unidade/ID de mensagem.
2. Callback Django identifica o destinatário ativo/verificado e os relatórios finais habilitados/revisados permitidos.
3. Retorna **Ver relatórios**, lista nativa, oito relatórios por página, com navegação. Sem números digitados para selecionar.
4. Seleção usa identificadores opacos da conversa; nomes enviados pelo contato não autorizam SQL.
5. Solicita parâmetros ordenados. Restrições do grant prevalecem sobre a resposta.
6. Datas em **DD/MM/AAAA**, destacadas com `*DD/MM/AAAA*` no texto enviado.
7. Toda pergunta de data mostra **Hoje**, **Ontem**, **Retornar ao menu**. Data calculada no clique, com fuso IANA da unidade, normalmente America/Sao_Paulo.
8. Botões antigos não preenchem a próxima pergunta. Intervalo inválido reapresenta as opções.
9. Removidas as instruções visíveis “opcional”, “em branco: hoje” e “PULAR”. Opcionalidade técnica continua para compatibilidade, sem orientar o usuário a pular.
10. Worker gera a execução e revalida acesso antes de transmitir.
11. Zero registros: **Não existem dados para a data selecionada.**, com botões; nenhum arquivo vazio para envio/download.
12. Após envio manual aceito: **Solicitar novamente** reinicia as perguntas do mesmo relatório; **Retornar ao menu** encerra preenchimento e abre a lista autorizada.
13. Não orientar a digitar MENU; usar botão. Comandos antigos seguem compatíveis.
14. Chaves idempotentes próprias para documento e continuidade. Resultado incerto nunca é repetido automaticamente.

Baileys fixado em `@whiskeysockets/baileys` **7.0.0-rc14**. Listas usam ListMessage + metadados biz/list; botões quick_reply usam interactive/native_flow. Não trocar por links externos ou mensagens numeradas sem autorização.

Sessão: volume Docker `baileys_sessions`, `/data/sessions.sqlite` no container. Autenticação/inbox criptografadas. Não copiar/publicar nem apagar o arquivo ou rotacionar sua chave como tentativa de conserto.

`list_accepted` é aceitação, não prova de exibição no aparelho. `outbound_delivered` e `outbound_read` são eventos distintos. Testes de payload não comprovam renderização no WhatsApp do destinatário.

Vazio é definido por zero registros, não por tamanho do PDF nem por valores numéricos zerados. SELECT agregador com uma linha de totais zero pode exigir regra específica, ainda a definir; não descartar resultados legítimos automaticamente.

## 7. Indicadores Médicos: integração efetiva

- Unidade `scv`, relatório `legacy123-40`, ID **50**, handler `medical_indicators_v1`, versão **2** na conferência.
- Conexão **19**: Oracle homologação **172.16.3.254:1521/hmlvotu**, usuário `dbamv`; senha apenas no cadastro autorizado/criptografado.
- Oracle antigo exige thick; Instant Client `/opt/oracle/instantclient_19_32` na imagem. Thin falhou com DPY-3010.
- `data_referencia`: fim exclusivo à meia-noite da data informada. Início em 1º de janeiro do ano anterior. Não inclui os dados do dia de referência.
- PDF: dois anos, 13 meses e janelas diárias do layout.
- **WhatsApp manual autorizado está liberado. Automático continua bloqueado no handler.** Geração de painel sem destinatário também permitida.

| Componente | Arquivo SQL inicial em `backend/operations/report_sql/indicadores_medicos/` |
|---|---|
| medical-stays | stays.sql — permanência mensal por convênio/especialidade. |
| medical-attendances | attendances.sql — atendimentos urgência/dia. |
| medical-exams | exams.sql — exames/dia. |
| medical-opinions-months | opinions_months.sql — pareceres urgência/mês. |
| medical-opinions-days | opinions_days.sql — pareceres urgência/dia. |

O SQL **executado vem do cadastro no banco**, não desses arquivos a cada execução. Arquivos são definições iniciais versionadas. Não sobrescrever o banco sem verificar alterações do administrador.

As cinco consultas usam a mesma conexão/transação Oracle somente leitura. Nenhum Firebird nesse caminho. Fontes principais: ATENDIME, MOV_INT, tabelas de convênio/especialidade/leito/unidade, PED_RX/ITPED_RX, PED_LAB/ITPED_LAB, PAR_MED e classificação de atendimentos.

### Regras que precisam ser preservadas

- Permanência: soma dos dias / quantidade de altas, ponderada. Não fazer média de médias.
- Convênios 1/2 SUS, 43 particular, demais convênio, conforme regra validada.
- Preservar joins e filtros de urgência, convênio, origem e empresa. A parte de imagem do SQL legado não tem o mesmo filtro explícito de empresa da parte laboratorial; não “corrigir” silenciosamente sem reconciliação.
- Exames/atendimentos: agregar separadamente antes de combinar; denominador zero sem razão, não infinito nem zero inventado.
- Pareceres: dias por registro arredondados em três casas, média em cinco e conversão para segundos conforme legado.
- Cada fonte tem data de referência própria: alta médica, atendimento, realização/laudo, parecer.

### Arquivos de layout

Persistente: `/opt/orbita/files/reports/indicadores-medicos/v1/`.
Montagem backend somente leitura: `/app/files/reports/indicadores-medicos/v1/`.

- first-background.png e last-background.png: artes extraídas dos slides fornecidos.
- JPGs correspondentes: cópias comprimidas usadas no PDF.
- logo.png, arial.ttf, arialbd.ttf.
- layout.json: ordem/especialidades e limites de cores do legado.

Esses são recursos estáticos, não resultados nem dados de pacientes. PDFs ficam protegidos na execução e são baixados pela API autorizada.

Sete páginas: capa, cinco páginas de indicadores, encerramento. Capa e encerramento não recebem cabeçalho hospitalar extra. Nas páginas internas, Dados atualizados até fica no cabeçalho. Essa data é a menor das últimas datas observadas nas quatro fontes e não prova, sozinha, completude da carga.

Execuções capturam versões de relatório, consultas e conexão, hashes das artes e datas de fonte. Alterações podem invalidar downloads antigos intencionalmente. Não remover controle para recuperar um link.

### Validação mais recente

Execução de painel `5ad022d6-7d9d-4091-945f-654a6a37a340`, referência 24/10/2026: **ready**, 3.280 linhas agregadas, aproximadamente 30 segundos, sem solicitação de entrega.

Últimos dados médicos observados na homologação: **28/08/2026**, exames até **29/08/2026**. Os PDFs antigos de produção via agregados Firebird têm dados de outubro. Não comparar esses números sem compatibilizar origem e período.

Produção identificada: **172.16.0.254:1521/prdvotu**. Ainda exige aceite específico da integração. Não mudar o destino da conexão 19 silenciosamente.

O comando `configure_medical_indicators` é instalação inicial e recusa sobrescrever cadastro existente. Não usá-lo como atualização periódica.

## 8. Onde está o legado e como acessar

Servidor Windows principal: **172.16.0.123**, aplicação **WhatsReport**, pasta **C:\WhatsReport**.

| Caminho | Finalidade |
|---|---|
| `C:\WhatsReport\WhatsReport.exe` | Aplicação legado de relatórios/envios. |
| `C:\WhatsReport\Servidor\BD\BASE.FDB` | Catálogo, permissões, parâmetros, composições/layouts e algumas rotinas. |
| `C:\WhatsReport\Servidor\BD\GLDADOS.FDB` | Cache histórico/apuração hospitalar. |
| `C:\WhatsReport\Servidor\BD\GLDADOS_ESUS.FDB` | Fonte local eSUS. |
| `C:\WhatsReport\Servidor\TInjectAnexos\comando.bat` | BAT observado com PDFtk; somente ler, não executar. |
| `C:\Controladoria\` | Documentos externos distribuídos pelo legado. |

Firebird geralmente na porta **3050**. Exemplo de destino: `172.16.0.123/3050:C:\WhatsReport\Servidor\BD\GLDADOS.FDB`. Usar credencial autorizada da operação, sem gravá-la em script. Não reutilizar a senha Oracle.

Arquivos foram investigados por SMB, inclusive compartilhamentos administrativos com conta autorizada. SSH no Windows não é garantido por este documento. Ferramentas/evidências SMB estão em `smb_reader`/`smb-reader`, dentro da pasta de investigação no SCV. Não alterar compartilhamentos ou abrir a rede.

Interface web legado observada: `http://172.16.0.123:8889/saw/`. Confirmar disponibilidade sem reiniciar o legado.

### Outras fontes cadastradas no legado

| Base | Tecnologia / destino | Observação |
|---|---|---|
| 1 | Oracle Santa Casa — 172.16.0.254:1521/prdvotu | Produção hospitalar. |
| 2 | Oracle AME — 172.19.0.250:1521/prdamevo | Consultas/exames AME. |
| 3 | Firebird .123, GLDADOS.FDB | Cache/apuração. |
| 4 | Firebird .123, BASE.FDB | Catálogo/gestores. |
| 5 | Oracle Jales | Destino não comprovado. |
| 6 | Oracle Santa Fé — 172.17.0.254 | Alias/serviço precisam ser reconciliados; documentos antigos diferem. |
| 7 e 19 | Firebird robô AME — 172.19.0.123, BASE.FDB | Confirmações/busca ativa. |
| 8 | Firebird Sansaúde — 172.16.0.124, BASE.FDB | Instalação diferente de .123. |
| 9 e 21 | Firebird NAS/UBS — 10.2.74.70, BASE.FDB | NAS/UBS/campanhas. |
| 10 | Firebird Jales — 172.18.0.123, BASE.FDB | Não confundir com Oracle. |
| 11 | Firebird Santa Fé — 172.17.200.21, BASE.FDB | Conexão da aplicação. |
| 13 | PostgreSQL eSUS — 167.249.56.126:54330/esus | Fonte externa; não presumir conexão testada. |
| 14 | Firebird .123, GLDADOS_ESUS.FDB | eSUS terminal. |
| 15 | Oracle Santa Casa — mesmo destino base 1 | Cadastro distinto. |
| 17 | Oracle SIGS — 172.16.2.254:1521/prdpmv | Consultas SIGS. |
| 22 | Firebird Ortopedia — 172.16.0.127:9020 | Porta especial conforme catálogo; confirmar. |

Tabela descreve cadastro/evidência, não conexão validada para todos os destinos. Consultar `docs/ORIGENS_BASES_LEGADAS.md` e `legacy.source_location` de cada relatório.

### Como o PDF legado é montado

WhatsReport contém **FortesReport Community Edition 4.0** e **TeeChart**. Layouts/cores/séries estão em tabelas do catálogo. Determinados documentos compostos são unidos por PDFtk. Não há um PDF-base universal editado para tudo.

Tabelas identificadas: TBRELATORIO, TBRELATORIO_CONFIGURACAO, TBRELATORIO_GRAFICO, TBRELATORIO_GRAFICO_CONFIG, TBRELATORIO_CORES e TBRELATORIO_MULTIPLOS.

Imagens localizadas em arquivos como cabecalho.jpeg, rodape.jpeg e IMAGENS\62_FUNDO_GRAFICO.JPG; não presumir BLOBs. Artefatos extraídos em `gerador-original-20261023/`.

Arquivos externos confirmados incluem `C:\Controladoria\Gerencial\INDICADORES_GERENCIAIS.pdf` e `C:\Controladoria\Estratégicos\INDICADORES_ESTRATEGICOS.pdf`. Outros painéis/vidas/internações estão cadastrados como external_file.

Nesses casos, o WhatsReport pode apenas buscar/distribuir o documento. SELECT de apoio não prova que ele calcula os indicadores. A máquina STI0682 / 172.16.60.38 e fontes compartilhadas apareceram na investigação, mas não foi comprovado que gerem todos os PDFs.

## 9. Pontos pendentes de dados

### Leitos

Origem Oracle DBAMV.LEITO + DBAMV.UNID_INT. COUNT(*) por unidade, ativos TP_SITUACAO=A, não extras SN_EXTRA=N, ocupações O/V/R/L, excluindo unidades 11/12/17. Data coletada = SYSDATE.

Homologação: 711 cadastros, 219 elegíveis/IDs distintos, 15 unidades. Contagem independente coincidiu com o SQL. Isso é posição atual, não capacidade em datas passadas.

Relatório 311 lê LEITOS_SISTEMA no Firebird entre WPA_DATA_INICIAL/WPA_DATA_FINAL. XLSX analisado tinha 461 linhas históricas, quatro colunas. Para retirar Firebird: implementar snapshots PostgreSQL e importar histórico aprovado. Não reconstruir passado usando cadastro atual.

### Vidas Sansaúde

Oracle: DBAPS.USUARIO, CONTRATO, DESLIGAMENTO, PLANO, TIP_ACOMODACAO, GRAU_PARENTESCO. SQL legado 268 tem regras históricas de elegibilidade; não simplificar para SN_ATIVO=S.

Legado: SAN_VIDAS_TEMP, SAN_VIDAS, SAN_VIDAS_MES e SAN_VIDAS_METAS. Pontos mensais são fotografias; anual não é soma dos meses. Origem/autoria da alimentação das metas ainda não comprovada. Homologação e produção têm números diferentes. PDF transcrito do original não é evidência de extração atual.

### Dados de mensagens/robôs

Estatísticas de respostas/contatos/desempenho usam rotinas como PROC_DESEMPENHO_EQUIPE. Parte dos dados só existe no robô, não no hospitalar. Selecionar conexão Oracle não resolve automaticamente essa dependência. Preservar alertas até investigação.

## 10. Evidências e documentos para consulta

Raiz: `/opt/backups/orbita/reports-catalog-20261022/`.

| Caminho relativo | Conteúdo |
|---|---|
| legacy/BASE_catalog.json | Catálogo extraído; pode ter BOM e IDs em string. |
| legacy/all_definitions.json | SQLs recuperados. |
| legacy/all_permissions.json | Consultas agrupadas de contatos, permissões, relatórios, programações, palavras-chave e composição; não presumir lista plana. |
| legacy/source_descriptions.json | Descrição das fontes. |
| legacy/legacy_procedure_metadata_all.json | Metadata/fontes disponíveis de procedures. |
| origens-pendentes-20261023/ | Rastreamento e SQLs numerados, incluindo sql_legado_17.sql. |
| gerador-original-20261023/ | Metadata, executáveis copiados, DFM/layouts e imagens. |
| validacao-medicos-oracle-direto/ | SQL parametrizado e reconciliação Oracle. |
| vidas-sansaude-20261023/ | Descobertas Oracle, snapshots e metas. |
| documentacao-oracle-relatorios-20261023/ | Guia de obtenção Oracle médico/vidas. |
| scv-render-original-style-20261023/ | Protótipos de render; data.json são agregados legados anteriores, não fonte viva. |
| FONTES_PDFS_CONTROLADORIA.md | Investigação de documentos externos. |
| FONTES_CONTROLADORIA_2026-10-23.md | Complemento da investigação. |

Documentação do projeto:

- `docs/relatorios/INDICADORES_MEDICOS_ORACLE.md`: trechos iniciais ainda dizem panel_only. **Prevalece a liberação manual WhatsApp descrita aqui e no código atual**.
- `docs/relatorios/ACOMPANHAMENTO_RELATORIOS.md`: tabela com checkboxes/estados; pode anteceder reclassificações. Reconciliar por unidade/código.
- `docs/RELATORIOS_SCV.md`, `docs/RELATORIOS_BAILEYS.md`: evolução do catálogo/canal; ler atualizações finais.
- `docs/relatorios/PERMISSOES_MANUAIS_POR_DESTINATARIO.md`: contrato atual; notas de não publicação são históricas da tarefa original, não diagnóstico atual.
- `docs/ORIGENS_BASES_LEGADAS.md`, `docs/ORIGENS_RELATORIOS_PENDENTES.md`.
- `docs/VALIDACAO_CALCULOS_RELATORIOS.md`: regras/reconciliação; conferir base/período.

Referências locais do usuário: `C:\Users\DELL\Downloads\relatorios scv\`, incluindo PDFs e EXPORTAR_TABELA_LEITOS.xlsx. Fonte operacional continua no remoto.

## 11. Comandos e validação

### Reconhecimento

```bash
ssh root@172.16.0.59
cd /opt/orbita
cat AGENTS.md
git status --short
docker compose ps
```

Não despejar .env, conexões completas ou logs brutos Baileys: bibliotecas podem imprimir estruturas sensíveis da sessão. Preferir eventos sanitizados do endpoint de status.

### Inventário Django sem dados sensíveis

```bash
docker exec -i orbita-api-1 python manage.py shell <<'PY'
from operations.models import ReportDefinition
from django.db.models import Count
print(list(ReportDefinition.objects.values('unit__slug','catalog_kind').annotate(total=Count('id'))))
print(list(ReportDefinition.objects.filter(code='legacy123-40').values('id','name','enabled','handler','version')))
PY
```

### Testes sem envios reais

```bash
cd /opt/orbita
docker compose run --rm --no-deps tests pytest -q -p no:cacheprovider \
  tests/test_report_whatsapp.py tests/test_report_catalog.py tests/test_medical_indicators.py
docker compose run --rm --no-deps baileys npm test
```

O perfil tests usa banco separado e transporte desativado/simulado. Não executar pytest com base de produção. Evitar suítes simultâneas no mesmo banco de testes; criar base isolada se necessário.

Verificar migrations, OpenAPI e build quando afetados. Último ajuste do botão menu passou em **91 testes backend e 11 Baileys**. Payload aprovado não comprova render no aparelho.

### Oracle já cadastrado, somente leitura

```python
from operations.models import ReportConnection
from operations.report_engine import connect
c = ReportConnection.objects.get(pk=19, unit__slug='scv')
with connect(c) as db:
    cursor = db.cursor()
    try:
        cursor.execute('SELECT 1 FROM DUAL')
        print(cursor.fetchone())
    finally:
        cursor.close()
```

O helper estabelece transação READ ONLY e faz rollback/close. Usar binds, timeout e limites nas consultas reais. Não imprimir pacientes nem executar COMMIT para contornar restrição.

Firebird investigativo: transação READ/SNAPSHOT, conta autorizada, no_db_triggers quando aplicável. Não executar business procedures desconhecidas. Selecionar metadata estritamente necessária, sem colunas de senhas.

### Publicação

1. Backup dos arquivos/configurações afetados em `/opt/backups/orbita/<tarefa>-<data>/`; proteger dados operacionais.
2. Editar escopo necessário, preservando mudanças de outros trabalhos.
3. Testar isoladamente, sem habilitar programações.
4. Rebuild dos serviços afetados; frontend exige panel. Backend deve chegar também ao worker/scheduler, não só api.
5. Usar `docker compose up -d --no-deps` apenas nos serviços afetados em manutenção autorizada. Restart Baileys interrompe momentaneamente sessão; não apagar volume.
6. Conferir saúde, API autenticada, geração e download; registrar evidência, ambiente e limites do aceite.

## 12. Problemas recentes: diagnóstico e correções

| Problema | Causa / ajuste |
|---|---|
| Execuções branca na troca de aba | Linhas antigas com created_at ausente provocavam RangeError Invalid time value. Escopo de unidade/aba e proteção de datas corrigidos; transição validada no navegador. |
| Lista aceita, mas sem resposta visível | Metadados biz/list adicionados. Aceitação separada de entrega/leitura; conferir aparelho. |
| Médico indisponível no WhatsApp | Bloqueio panel_only da homologação removido apenas para manual autorizado. Automática continua bloqueada. |
| Datas em inglês/ISO | Labels/prompts em português e DD/MM/AAAA. Armazenamento/binds seguem ISO intencionalmente. |
| Nome repetido no menu | Título/descrição repetiam o nome. Descrição agora vazia ou apenas continuação. |
| Suspeita de geração dupla | Teste com evento repetido e novo ID gera uma execução. Verificar ReportExecution/chaves antes de afirmar duplicação de PDF. |
| Arquivo sem registros | Resposta com botões sem arquivo vazio. |
| Exigia digitar MENU | Botão Retornar ao menu nas respostas e datas. |

## 13. Próximos passos

1. Validar no aplicativo autorizado o fluxo completo: lista, datas, erro de intervalo, PDF médico, Solicitar novamente e Retornar ao menu.
2. Conferir o recorte temporal da homologação antes de comparar números recentes.
3. Homologar produção médica separadamente, com leitura autorizada e reconciliação.
4. Integrar Leitos com snapshots/histórico PostgreSQL.
5. Resolver metas/históricos de Vidas sem tratar dados transcritos como consulta atual.
6. Prosseguir investigação dos geradores externos da Controladoria.
7. Validar backup/restauração e organizar commits sem incluir segredos, pacientes ou trabalho não relacionado.
8. Atualizar a tabela de acompanhamento por unidade/código conforme aceite.

## 14. Prompt para a próxima sessão

> Trabalhe exclusivamente em root@172.16.0.59:/opt/orbita. Leia AGENTS.md e docs/relatorios/PASSAGEM_TECNICA_RELATORIOS_LLM.md. O foco é relatórios do SCV Messenger e migração do WhatsReport legado .123 para consultas diretas. Não alterar servidores/bancos legados, habilitar programações ou enviar mensagens reais sem autorização específica. Preserve segredos, login e mudanças existentes. Confirme código/inventário vivo antes de editar. Indicadores Médicos usa Oracle hmlvotu e permite solicitação manual WhatsApp autorizada; automática bloqueada. Distinga fato comprovado de pendência e valide o fluxo completo no ambiente correto.

## 15. Apêndice — catálogo atual

Extração em 24/10/2026. Ativo é estado cadastral, não prova de uso recente ou geração bem-sucedida. Uma linha por unidade/código, incluindo componentes e rotinas. Sem SQL, destinatários ou segredos.

| ID | Unidade | Tipo | Código | Nome | Ativo | Fonte cadastrada | Conexão cadastrada | Pendência cadastrada |
|---|---|---|---|---|---|---|---|---|
| 6 | AME Votuporanga | Relatório | contacts | Acompanhamentos e contatos | Sim | local | — | — |
| 8 | AME Votuporanga | Relatório | not-sent | Agendamentos com mensagens não enviadas | Sim | local | — | — |
| 1 | AME Votuporanga | Relatório | confirmed | Agendamentos confirmados | Sim | local | — | — |
| 3 | AME Votuporanga | Relatório | not-confirmed | Agendamentos não confirmados | Sim | local | — | — |
| 9 | AME Votuporanga | Relatório | combined | Agendamentos não enviados / não confirmados | Sim | local | — | — |
| 2 | AME Votuporanga | Relatório | declined | Agendamentos recusados | Sim | local | — | — |
| 7 | AME Votuporanga | Relatório | legacy-stock | Estoque — entrada e saída de empréstimos | Não | oracle | — | Definição identificada no servidor 172.16.0.124; vínculo com esta unidade, consulta e conta de leitura ainda precisam de homologação. |
| 5 | AME Votuporanga | Relatório | failures | Falhas e bloqueios de comunicação | Sim | local | — | — |
| 4 | AME Votuporanga | Relatório | no-response | Sem resposta no prazo | Sim | local | — | — |
| 69 | SCV | Componente | legacy123-59 | 00 - SINCRINIZAR COMPLETO PARTE 1 | Não | legacy_pending | — | Revisar componentes e fórmulas do relatório composto; Rotina interna; não executar como relatório de leitura |
| 71 | SCV | Componente | legacy123-61 | 00 - SINCRINIZAR COMPLETO PARTE 2 | Não | legacy_pending | — | Revisar componentes e fórmulas do relatório composto; Rotina interna; não executar como relatório de leitura |
| 40 | SCV | Componente | legacy123-28 | 52 - LIMPAR_CONSULTAS_MEDICAS_AME_VOTU | Não | legacy_pending | Legado 4 · Firebird local · WhatsReport e gestores | Converter procedure Firebird para consulta direta no Oracle: PROC_LIMPAR_CONSULTAS_MEDICAS; Rotina interna; não executar como relatório de leitura |
| 41 | SCV | Componente | legacy123-29 | 53 - LIMPAR_EXAMES_MEDICAS_AME_VOTU | Não | legacy_pending | Legado 4 · Firebird local · WhatsReport e gestores | Converter procedure Firebird para consulta direta no Oracle: PROC_LIMPAR_EXAMES_MEDICAS; Rotina interna; não executar como relatório de leitura |
| 55 | SCV | Componente | legacy123-45 | ALTAS ATE AS 10 HORAS - CABECALHO | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Substituir consulta ao cache Firebird por consulta Oracle |
| 48 | SCV | Componente | legacy123-38 | ALTAS ATE AS 10 HORAS - GERAL | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 51 | SCV | Componente | legacy123-41 | ALTAS ATE AS 10 HORAS - NUMERO DE ALTAS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 56 | SCV | Componente | legacy123-46 | ALTAS ATE AS 10 HORAS - RODAPE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Substituir consulta ao cache Firebird por consulta Oracle |
| 323 | SCV | Componente | legacy123-331 | AME JALES - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP PÓS CIRÚGICO | Não | application_pending | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 324 | SCV | Componente | legacy123-332 | AME JALES - MÉDIA DE LIGAÇÕES POR ATENDENTE PÓS CIRÚGICO | Não | sql | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 325 | SCV | Componente | legacy123-333 | AME JALES - QUANTIDADE DE PACIENTES CONTATADOS PÓS CIRÚGICO | Não | sql | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 326 | SCV | Componente | legacy123-334 | AME JALES - QUANTIDADE DE RESPOSTAS POR WHATSAPP PÓS CIRÚGICO | Não | application_pending | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 129 | SCV | Componente | legacy123-123 | AME SANTA FE - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 11 · Firebird robô AME Santa Fé · 172.17.200.21 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 90 | SCV | Componente | legacy123-83 | AME VOTUPORANGA - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 89 | SCV | Componente | legacy123-82 | AME VOTUPORANGA - MÉDIA DE LIGAÇÕES POR ATENDENTE | Não | sql | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 92 | SCV | Componente | legacy123-85 | AME VOTUPORANGA - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 91 | SCV | Componente | legacy123-84 | AME VOTUPORANGA - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 45 | SCV | Componente | legacy123-33 | ATENDIMENTOS | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 70 | SCV | Componente | legacy123-60 | ATENDIMENTOS_PS | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 318 | SCV | Componente | legacy123-325 | BUSCA ATIVA ANALITICA POR RESPOSTA | Não | application_pending | Legado 19 · Firebird robô AME Votuporanga · busca ativa | Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 345 | SCV | Componente | legacy123-554 | BUSCA ATIVA POR ESPECIALIDADE | Não | application_pending | Legado 19 · Firebird robô AME Votuporanga · busca ativa | Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 164 | SCV | Componente | legacy123-158 | CAROBEIRAS - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 165 | SCV | Componente | legacy123-159 | CAROBEIRAS - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 166 | SCV | Componente | legacy123-160 | CAROBEIRAS - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 140 | SCV | Componente | legacy123-134 | CECAP - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 141 | SCV | Componente | legacy123-135 | CECAP - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 142 | SCV | Componente | legacy123-136 | CECAP - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 67 | SCV | Componente | legacy123-57 | CIRURGIAS | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 105 | SCV | Componente | legacy123-99 | COLINAS - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 106 | SCV | Componente | legacy123-100 | COLINAS - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 107 | SCV | Componente | legacy123-101 | COLINAS - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 313 | SCV | Componente | legacy123-317 | CONSULTAS_MEDICAS | Não | sql | Legado 13 · PostgreSQL eSUS · 167.249.56.126 | Validar objeto de origem (view/procedure a identificar): SINCRONIZAR_ROB8 |
| 118 | SCV | Componente | legacy123-112 | DONA NINA - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 119 | SCV | Componente | legacy123-113 | DONA NINA - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 120 | SCV | Componente | legacy123-114 | DONA NINA - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 179 | SCV | Componente | legacy123-174 | ESUS - GERAR TABELA MENSAL | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 47 | SCV | Componente | legacy123-35 | EXAMES | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 62 | SCV | Componente | legacy123-52 | EXAMES POR ATENDIMENTO - DESEMPENHO INDIVIDUAL | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_exames_por_atendimento |
| 52 | SCV | Componente | legacy123-42 | EXAMES POR ATENDIMENTO - GERAL | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_exames_por_atendimento |
| 61 | SCV | Componente | legacy123-51 | EXAMES POR ATENDIMENTO - TABELA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_exames_por_atendimento |
| 333 | SCV | Componente | legacy123-402 | FALTANTES ANALITICA POR DATA DE RESPOSTA | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 335 | SCV | Componente | legacy123-404 | FALTANTES ANALITICA POR DATA DE RESPOSTA | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 336 | SCV | Componente | legacy123-410 | FALTANTES ANALITICA POR DATA DE RESPOSTA | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 337 | SCV | Componente | legacy123-411 | FALTANTES ANALITICA POR DATA DE RESPOSTA | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 338 | SCV | Componente | legacy123-412 | FALTANTES POR ESPECIALIDADE | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 80 | SCV | Componente | legacy123-70 | FPO_AIH | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 87 | SCV | Componente | legacy123-80 | FPO_AIH | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Substituir consulta ao cache Firebird por consulta Oracle |
| 79 | SCV | Componente | legacy123-69 | FPO_AMBULATORIAL | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 83 | SCV | Componente | legacy123-74 | FPO_COMPLEXIDADE_AMB | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 82 | SCV | Componente | legacy123-72 | FPO_PROCEDIMENTO_SUS | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 35 | SCV | Componente | legacy123-23 | GERAR_LEITOS_DISPONIVEIS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_LEITOS_DISPONIVEIS |
| 174 | SCV | Componente | legacy123-168 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 195 | SCV | Componente | legacy123-190 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 200 | SCV | Componente | legacy123-195 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 205 | SCV | Componente | legacy123-200 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 210 | SCV | Componente | legacy123-205 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 215 | SCV | Componente | legacy123-210 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 220 | SCV | Componente | legacy123-215 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 225 | SCV | Componente | legacy123-220 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 230 | SCV | Componente | legacy123-225 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 235 | SCV | Componente | legacy123-230 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 240 | SCV | Componente | legacy123-235 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 245 | SCV | Componente | legacy123-240 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 250 | SCV | Componente | legacy123-245 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 255 | SCV | Componente | legacy123-251 | GRAFICO FICHAS SEM CPF | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 177 | SCV | Componente | legacy123-171 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 196 | SCV | Componente | legacy123-191 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 201 | SCV | Componente | legacy123-196 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 206 | SCV | Componente | legacy123-201 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 211 | SCV | Componente | legacy123-206 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 216 | SCV | Componente | legacy123-211 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 221 | SCV | Componente | legacy123-216 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 226 | SCV | Componente | legacy123-221 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 231 | SCV | Componente | legacy123-226 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 236 | SCV | Componente | legacy123-231 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 241 | SCV | Componente | legacy123-236 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 246 | SCV | Componente | legacy123-241 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 251 | SCV | Componente | legacy123-246 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 256 | SCV | Componente | legacy123-252 | GRAFICO FICHAS SEM NOME PACIENTE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 172 | SCV | Componente | legacy123-166 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 197 | SCV | Componente | legacy123-192 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 202 | SCV | Componente | legacy123-197 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 207 | SCV | Componente | legacy123-202 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 212 | SCV | Componente | legacy123-207 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 217 | SCV | Componente | legacy123-212 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 222 | SCV | Componente | legacy123-217 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 227 | SCV | Componente | legacy123-222 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 232 | SCV | Componente | legacy123-227 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 237 | SCV | Componente | legacy123-232 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 242 | SCV | Componente | legacy123-237 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 247 | SCV | Componente | legacy123-242 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 252 | SCV | Componente | legacy123-247 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 257 | SCV | Componente | legacy123-253 | GRAFICO POR DESFECHO DE VISITA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 175 | SCV | Componente | legacy123-169 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 198 | SCV | Componente | legacy123-193 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 203 | SCV | Componente | legacy123-198 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 208 | SCV | Componente | legacy123-203 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 213 | SCV | Componente | legacy123-208 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 218 | SCV | Componente | legacy123-213 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 223 | SCV | Componente | legacy123-218 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 228 | SCV | Componente | legacy123-223 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 233 | SCV | Componente | legacy123-228 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 238 | SCV | Componente | legacy123-233 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 243 | SCV | Componente | legacy123-238 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 248 | SCV | Componente | legacy123-243 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 253 | SCV | Componente | legacy123-248 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 258 | SCV | Componente | legacy123-254 | GRAFICO VISITAS POR MICRO AREA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 339 | SCV | Componente | legacy123-413 | INDICADORES - BUSCA ATIVA | Não | application_pending | Legado 1 · Oracle Santa Casa · prdvotu | Revisar componentes e fórmulas do relatório composto; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 42 | SCV | Componente | legacy123-30 | INTERNACAO_USUARIO | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 350 | SCV | Componente | medical-attendances | Indicadores Médicos · Atendimentos de urgência por dia | Sim | sql | Oracle Santa Casa · Homologação · hmlvotu | — |
| 351 | SCV | Componente | medical-exams | Indicadores Médicos · Exames realizados por dia | Sim | sql | Oracle Santa Casa · Homologação · hmlvotu | — |
| 353 | SCV | Componente | medical-opinions-days | Indicadores Médicos · Pareceres de urgência por dia | Sim | sql | Oracle Santa Casa · Homologação · hmlvotu | — |
| 352 | SCV | Componente | medical-opinions-months | Indicadores Médicos · Pareceres de urgência por mês | Sim | sql | Oracle Santa Casa · Homologação · hmlvotu | — |
| 349 | SCV | Componente | medical-stays | Indicadores Médicos · Permanência por convênio e especialidade | Sim | sql | Oracle Santa Casa · Homologação · hmlvotu | — |
| 136 | SCV | Componente | legacy123-130 | JARDIM MARIN - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 137 | SCV | Componente | legacy123-131 | JARDIM MARIN - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 138 | SCV | Componente | legacy123-132 | JARDIM MARIN - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 30 | SCV | Componente | legacy123-17 | LEITOS_SISTEMA | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 85 | SCV | Componente | legacy123-78 | LIMPAR TABELAS AMB E AIH | Não | legacy_pending | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_LIMPAR_FPO_AMB_AIH; Rotina interna; não executar como relatório de leitura |
| 44 | SCV | Componente | legacy123-32 | LIMPAR_ATENDIMENTOS | Não | legacy_pending | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_LIMPAR_ATENDIMENTOS; Rotina interna; não executar como relatório de leitura |
| 46 | SCV | Componente | legacy123-34 | LIMPAR_EXAMES | Não | legacy_pending | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_LIMPAR_EXAMES; Rotina interna; não executar como relatório de leitura |
| 43 | SCV | Componente | legacy123-31 | LIMPAR_INTERNACAO_USUARIO | Não | legacy_pending | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_LIMPAR_INTERNACAO_USUARIO; Rotina interna; não executar como relatório de leitura |
| 34 | SCV | Componente | legacy123-22 | LIMPAR_PACIENTES_DIA | Não | legacy_pending | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_LIMPAR_PACIENTES_DIA; Rotina interna; não executar como relatório de leitura |
| 260 | SCV | Componente | legacy123-256 | LIMPAR_PRODUCAO_AGENTE | Não | legacy_pending | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_LIMPAR_PRODUCAO_AGENTE; Rotina interna; não executar como relatório de leitura |
| 72 | SCV | Componente | legacy123-62 | MEDIA ATENDIMENTOS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 74 | SCV | Componente | legacy123-64 | MEDIA DE CIRURGIAS - ELETIVAS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 68 | SCV | Componente | legacy123-58 | MEDIA DE CIRURGIAS - TOTAL | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 75 | SCV | Componente | legacy123-65 | MEDIA DE CIRURGIAS - URGENCIA E EMERGENCIA | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 37 | SCV | Componente | legacy123-25 | PACIENTE DIA E TAXA DE OCUPAÇÃO - CONVENIO | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_RESUMO_ATENDIMENTOS |
| 32 | SCV | Componente | legacy123-19 | PACIENTE DIA E TAXA DE OCUPAÇÃO - GERAL | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_RESUMO_ATENDIMENTOS |
| 36 | SCV | Componente | legacy123-24 | PACIENTE DIA E TAXA DE OCUPAÇÃO - SUS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_RESUMO_ATENDIMENTOS |
| 29 | SCV | Componente | legacy123-16 | PACIENTES_DIA | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 148 | SCV | Componente | legacy123-142 | PAINEIRAS - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 149 | SCV | Componente | legacy123-143 | PAINEIRAS - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 150 | SCV | Componente | legacy123-144 | PAINEIRAS - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 152 | SCV | Componente | legacy123-146 | PALMEIRAS - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 153 | SCV | Componente | legacy123-147 | PALMEIRAS - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 154 | SCV | Componente | legacy123-148 | PALMEIRAS - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 76 | SCV | Componente | legacy123-66 | PARECER | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 78 | SCV | Componente | legacy123-68 | PARECER MEDICO POR ESPECIALIDADE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 77 | SCV | Componente | legacy123-67 | PARECER_ATENDIMENTOS | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 110 | SCV | Componente | legacy123-104 | PARQUE DAS NAÇÕES - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 111 | SCV | Componente | legacy123-105 | PARQUE DAS NAÇÕES - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 112 | SCV | Componente | legacy123-106 | PARQUE DAS NAÇÕES - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 265 | SCV | Componente | legacy123-261 | POLICLINICA - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 266 | SCV | Componente | legacy123-262 | POLICLINICA - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 267 | SCV | Componente | legacy123-263 | POLICLINICA - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 100 | SCV | Componente | legacy123-93 | PRO POVO - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 102 | SCV | Componente | legacy123-96 | PRO POVO - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 103 | SCV | Componente | legacy123-97 | PRO POVO - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 170 | SCV | Componente | legacy123-164 | PRODUCAO_AGENTE | Não | sql | Legado 13 · PostgreSQL eSUS · 167.249.56.126 | — |
| 263 | SCV | Componente | legacy123-259 | PRODUCAO_AGENTE | Não | sql | Legado 13 · PostgreSQL eSUS · 167.249.56.126 | — |
| 320 | SCV | Componente | legacy123-327 | RANKING GRAFICO BUSCA ATIVA | Não | application_pending | Legado 19 · Firebird robô AME Votuporanga · busca ativa | Definição de consulta não recuperada; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 176 | SCV | Componente | legacy123-170 | RANKING MÉDIA VISITAS ACS POR UNIDADE DE SAUDE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 321 | SCV | Componente | legacy123-328 | RANKING POR TIPO DE RESPOSTA | Não | sql | Legado 19 · Firebird robô AME Votuporanga · busca ativa | — |
| 346 | SCV | Componente | legacy123-555 | RANKING POR TIPO DE RESPOSTA | Não | sql | Legado 19 · Firebird robô AME Votuporanga · busca ativa | — |
| 334 | SCV | Componente | legacy123-403 | RANKING POR TIPO DE RESPOSTA - GERAL | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 275 | SCV | Componente | legacy123-275 | RELATORIO DE CONSULTAS - CM PAINEIRAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 288 | SCV | Componente | legacy123-288 | RELATORIO DE CONSULTAS - POLICLINICA | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 295 | SCV | Componente | legacy123-295 | RELATORIO SAIDA DE MEDICAMENTOS -  PAINEIRAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 94 | SCV | Componente | legacy123-87 | SANSAUDE - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 8 · Firebird robô Sansaúde · 172.16.0.124 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 95 | SCV | Componente | legacy123-88 | SANSAUDE - MÉDIA DE LIGAÇÕES POR ATENDENTE | Não | sql | Legado 8 · Firebird robô Sansaúde · 172.16.0.124 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 96 | SCV | Componente | legacy123-89 | SANSAUDE - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 8 · Firebird robô Sansaúde · 172.16.0.124 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 97 | SCV | Componente | legacy123-90 | SANSAUDE - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 8 · Firebird robô Sansaúde · 172.16.0.124 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 270 | SCV | Componente | legacy123-268 | SAN_VIDAS_TEMP | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | — |
| 160 | SCV | Componente | legacy123-154 | SIMONSEN - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 161 | SCV | Componente | legacy123-155 | SIMONSEN - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 162 | SCV | Componente | legacy123-156 | SIMONSEN - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 122 | SCV | Componente | legacy123-116 | SÃO COSME - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 123 | SCV | Componente | legacy123-117 | SÃO COSME - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 124 | SCV | Componente | legacy123-118 | SÃO COSME - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 156 | SCV | Componente | legacy123-150 | SÃO JOÃO - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 157 | SCV | Componente | legacy123-151 | SÃO JOÃO - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 158 | SCV | Componente | legacy123-152 | SÃO JOÃO - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 53 | SCV | Componente | legacy123-43 | TAXA DE OCUPAÇÃO - CABECALHO  | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Substituir consulta ao cache Firebird por consulta Oracle |
| 54 | SCV | Componente | legacy123-44 | TAXA DE OCUPAÇÃO - RODAPE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Substituir consulta ao cache Firebird por consulta Oracle |
| 31 | SCV | Componente | legacy123-18 | TAXA DE OCUPAÇÃO POR SETOR | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_RESUMO_ATENDIMENTOS |
| 73 | SCV | Componente | legacy123-63 | TEMPO MEDIO PERMANENCIA - ESPECIALIDADES SUS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 64 | SCV | Componente | legacy123-54 | TEMPO MEDIO PERMANENCIA - GERAL | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 188 | SCV | Componente | legacy123-183 | UBS CAROBEIRAS - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 194 | SCV | Componente | legacy123-189 | UBS DONA NINA - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 181 | SCV | Componente | legacy123-176 | UBS GERAL - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 182 | SCV | Componente | legacy123-177 | UBS PAINEIRAS - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 191 | SCV | Componente | legacy123-186 | UBS PALMEIRAS - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 184 | SCV | Componente | legacy123-179 | UBS PARQUE DAS NACOES - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 190 | SCV | Componente | legacy123-185 | UBS PRO-POVO - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 192 | SCV | Componente | legacy123-187 | UBS SAO COSME - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 186 | SCV | Componente | legacy123-181 | UBS SAO JOAO - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 193 | SCV | Componente | legacy123-188 | UBS SIMONSEN - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 185 | SCV | Componente | legacy123-180 | UBS VILA AMERICA - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 187 | SCV | Componente | legacy123-182 | UBS VILA MARIN - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 171 | SCV | Componente | legacy123-165 | UBS VILA PAES - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 144 | SCV | Componente | legacy123-138 | VILA AMÉRICA - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 145 | SCV | Componente | legacy123-139 | VILA AMÉRICA - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 146 | SCV | Componente | legacy123-140 | VILA AMÉRICA - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 114 | SCV | Componente | legacy123-108 | VILA PAES - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 115 | SCV | Componente | legacy123-109 | VILA PAES - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 116 | SCV | Componente | legacy123-110 | VILA PAES - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 81 | SCV | Relatório | legacy123-71 | AGENDAMENTOS NAO CONFIRMADOS - RESTRICOES | Não | application_pending | Legado 1 · Oracle Santa Casa · prdvotu | Validar objeto de origem (view/procedure a identificar): dbamv.vdic_mges_033; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 49 | SCV | Relatório | legacy123-39 | ALTAS ATE AS 10 HORAS - META | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 262 | SCV | Relatório | legacy123-258 | ALTERAR MES PRODUCAO ACS | Não | legacy_pending | Legado 4 · Firebird local · WhatsReport e gestores | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTERAR_PRODUCAO_ACS; Rotina interna; não executar como relatório de leitura |
| 130 | SCV | Relatório | legacy123-124 | AME JALES - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 131 | SCV | Relatório | legacy123-125 | AME JALES - INDICADORES | Não | composite | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Revisar componentes e fórmulas do relatório composto |
| 327 | SCV | Relatório | legacy123-335 | AME JALES - INDICADORES PÓS CIRÚGICO | Não | composite | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Revisar componentes e fórmulas do relatório composto |
| 132 | SCV | Relatório | legacy123-126 | AME JALES - MÉDIA DE LIGAÇÕES POR ATENDENTE | Não | sql | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 328 | SCV | Relatório | legacy123-336 | AME JALES - POS CIRURGICO | Não | sql | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | — |
| 133 | SCV | Relatório | legacy123-127 | AME JALES - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 134 | SCV | Relatório | legacy123-128 | AME JALES - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 10 · Firebird robô AME Jales · 172.18.0.123 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 125 | SCV | Relatório | legacy123-119 | AME SANTA FE - ESTATÍSTICA DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 11 · Firebird robô AME Santa Fé · 172.17.200.21 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 126 | SCV | Relatório | legacy123-120 | AME SANTA FE - INDICADORES | Não | composite | Legado 11 · Firebird robô AME Santa Fé · 172.17.200.21 | Revisar componentes e fórmulas do relatório composto |
| 127 | SCV | Relatório | legacy123-121 | AME SANTA FE - MÉDIA DE LIGAÇÕES POR ATENDENTE | Não | sql | Legado 11 · Firebird robô AME Santa Fé · 172.17.200.21 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 128 | SCV | Relatório | legacy123-122 | AME SANTA FE - QUANTIDADE DE PACIENTES CONTATADOS | Não | sql | Legado 11 · Firebird robô AME Santa Fé · 172.17.200.21 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe |
| 93 | SCV | Relatório | legacy123-86 | AME VOTUPORANGA - INDICADORES | Não | composite | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Revisar componentes e fórmulas do relatório composto |
| 86 | SCV | Relatório | legacy123-79 | ATUALIZAR FPO | Não | composite | — | Revisar componentes e fórmulas do relatório composto |
| 17 | SCV | Relatório | contacts | Acompanhamentos e contatos | Sim | local | — | — |
| 13 | SCV | Relatório | not-sent | Agendamentos com mensagens não enviadas | Sim | local | — | — |
| 10 | SCV | Relatório | confirmed | Agendamentos confirmados | Sim | local | — | — |
| 12 | SCV | Relatório | not-confirmed | Agendamentos não confirmados | Sim | local | — | — |
| 14 | SCV | Relatório | combined | Agendamentos não enviados / não confirmados | Sim | local | — | — |
| 11 | SCV | Relatório | declined | Agendamentos recusados | Sim | local | — | — |
| 319 | SCV | Relatório | legacy123-326 | BUSCA ATIVA ANALITICA POR DATA DE RESPOSTA | Não | application_pending | Legado 19 · Firebird robô AME Votuporanga · busca ativa | Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 348 | SCV | Relatório | legacy123-557 | BUSCA ATIVA ANALITICA POR DATA DE RESPOSTA | Não | application_pending | Legado 19 · Firebird robô AME Votuporanga · busca ativa | Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 343 | SCV | Relatório | legacy123-551 | BUSCA ATIVA ANALITICA POR RESPOSTA | Não | application_pending | Legado 19 · Firebird robô AME Votuporanga · busca ativa | Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 317 | SCV | Relatório | legacy123-323 | CAMPANHA RH | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 315 | SCV | Relatório | legacy123-320 | CAMPANHAS: CATARATA E GLAUCOMA | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 330 | SCV | Relatório | legacy123-338 | CAMPANHAS: EXAMES | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 167 | SCV | Relatório | legacy123-161 | CAROBEIRAS - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 143 | SCV | Relatório | legacy123-137 | CECAP - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 329 | SCV | Relatório | legacy123-337 | CECAP - QUANTIDADE DE RESPOSTAS POR WHATSAPP | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: proc_desempenho_equipe; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 104 | SCV | Relatório | legacy123-98 | COLINAS - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 33 | SCV | Relatório | legacy123-20 | COMPLETO TAXA OCUPAÇÃO | Não | composite | — | Revisar componentes e fórmulas do relatório composto |
| 65 | SCV | Relatório | legacy123-55 | COMPLETO TAXA OCUPAÇÃO | Não | composite | — | Revisar componentes e fórmulas do relatório composto |
| 58 | SCV | Relatório | legacy123-48 | CONSULTAS E EXAMES - CONFIRMADOS | Não | application_pending | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 59 | SCV | Relatório | legacy123-49 | CONSULTAS E EXAMES - MENSAGENS NÃO ENVIADAS | Não | application_pending | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 60 | SCV | Relatório | legacy123-50 | CONSULTAS E EXAMES - MENSAGENS NÃO ENVIADAS / NÃO CONFIRMADAS | Não | application_pending | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Revisar componentes e fórmulas do relatório composto; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 57 | SCV | Relatório | legacy123-47 | CONSULTAS E EXAMES - NAO CONFIRMADOS | Não | application_pending | Legado 7 · Firebird robô AME Votuporanga · 172.19.0.123 | Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 38 | SCV | Relatório | legacy123-26 | CONSULTAS_MEDICAS_AME_VOTU | Não | sql | Legado 2 · Oracle AME Votuporanga · prdamevo | Validar objeto de origem (view/procedure a identificar): SINCRONIZAR_ROB8 |
| 117 | SCV | Relatório | legacy123-111 | DONA NINA - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 28 | SCV | Relatório | legacy123-1 | ESTOQUE - ENTRADA E SAIDA DE EMPRESTIMOS | Não | sql | Legado 1 · Oracle Santa Casa · prdvotu | Validar objeto de origem (view/procedure a identificar): dbamv.vdic_mges_033 |
| 261 | SCV | Relatório | legacy123-257 | ESUS - SINCRONIZAR COMPLETO | Não | legacy_pending | — | Revisar componentes e fórmulas do relatório composto; Rotina interna; não executar como relatório de leitura |
| 63 | SCV | Relatório | legacy123-53 | EXAMES POR ATENDIMENTO - COMPLETO | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 39 | SCV | Relatório | legacy123-27 | EXAMES_MEDICOS_AME_VOTU | Não | sql | Legado 2 · Oracle AME Votuporanga · prdamevo | Validar objeto de origem (view/procedure a identificar): SINCRONIZAR_ROB8 |
| 310 | SCV | Relatório | legacy123-311 | EXPORTAR TABELA LEITOS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Substituir consulta ao cache Firebird por consulta Oracle |
| 18 | SCV | Relatório | legacy-stock | Estoque — entrada e saída de empréstimos | Não | oracle | — | Definição identificada no servidor 172.16.0.124; vínculo com esta unidade, consulta e conta de leitura ainda precisam de homologação. |
| 344 | SCV | Relatório | legacy123-552 | FALTANTES - PACIENTES IMPORTADOS | Não | sql | Legado 19 · Firebird robô AME Votuporanga · busca ativa | — |
| 331 | SCV | Relatório | legacy123-400 | FALTANTES POR ESPECIALIDADE - GERAL | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 84 | SCV | Relatório | legacy123-75 | FPO - MAC DECENDIO FINANCEIRO | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_FPO |
| 88 | SCV | Relatório | legacy123-81 | FPO - MAC DECENDIO FISICO | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_FPO |
| 16 | SCV | Relatório | failures | Falhas e bloqueios de comunicação | Sim | local | — | — |
| 314 | SCV | Relatório | legacy123-319 | GESTÃO DE MENSAGENS | Não | application_pending | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Converter procedure Firebird para consulta direta no Oracle: PROC_GESTAO_MENSAGENS; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 135 | SCV | Relatório | legacy123-129 | GRUPO SANTA CASA - INDICADORES | Não | composite | Legado 8 · Firebird robô Sansaúde · 172.16.0.124 | Revisar componentes e fórmulas do relatório composto |
| 322 | SCV | Relatório | legacy123-329 | INDICADORES - BUSCA ATIVA | Não | application_pending | Legado 19 · Firebird robô AME Votuporanga · busca ativa | Revisar componentes e fórmulas do relatório composto; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 332 | SCV | Relatório | legacy123-401 | INDICADORES - BUSCA ATIVA | Não | application_pending | Legado 21 · Firebird robô NAS · consultas de campanhas | Revisar componentes e fórmulas do relatório composto; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 347 | SCV | Relatório | legacy123-556 | INDICADORES - BUSCA ATIVA | Não | application_pending | Legado 19 · Firebird robô AME Votuporanga · busca ativa | Revisar componentes e fórmulas do relatório composto; Integração com mensagens/robô/Meta pendente; preservada sem implementação |
| 308 | SCV | Relatório | legacy123-309 | INDICADORES - PAINEL LEITOS | Sim | external_file | PDF local, sem conexão | Aguardando publicação manual do PDF e aceite no aparelho |
| 312 | SCV | Relatório | legacy123-315 | INDICADORES - RANKING FALTANTES | Não | composite | Legado 21 · Firebird robô NAS · consultas de campanhas | Revisar componentes e fórmulas do relatório composto |
| 309 | SCV | Relatório | legacy123-310 | INDICADORES - VIDAS SANSAUDE | Não | composite | — | Revisar componentes e fórmulas do relatório composto |
| 99 | SCV | Relatório | legacy123-92 | INDICADORES AME E SANSAUDE | Não | composite | — | Revisar componentes e fórmulas do relatório composto |
| 169 | SCV | Relatório | legacy123-163 | INDICADORES ESTRATEGICOS | Não | external_file | Legado 3 · Firebird local · indicadores e cache hospitalar | Arquivo-fonte externo e rotina de publicação pendentes |
| 168 | SCV | Relatório | legacy123-162 | INDICADORES GERENCIAIS | Não | external_file | Legado 3 · Firebird local · indicadores e cache hospitalar | Arquivo-fonte externo e rotina de publicação pendentes |
| 272 | SCV | Relatório | legacy123-270 | INDICADORES INTERNACOES PS | Não | external_file | Legado 3 · Firebird local · indicadores e cache hospitalar | Arquivo-fonte externo e rotina de publicação pendentes |
| 50 | SCV | Relatório | legacy123-40 | INDICADORES MEDICOS | Sim | composite | Oracle Santa Casa · Homologação · hmlvotu | — |
| 66 | SCV | Relatório | legacy123-56 | INDICADORES MEDICOS | Não | composite | — | Revisar componentes e fórmulas do relatório composto |
| 271 | SCV | Relatório | legacy123-269 | INDICADORES VIDAS SANSAUDE | Não | external_file | Legado 3 · Firebird local · indicadores e cache hospitalar | Arquivo-fonte externo e rotina de publicação pendentes |
| 139 | SCV | Relatório | legacy123-133 | JARDIM MARIN - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 108 | SCV | Relatório | legacy123-102 | NAS - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 151 | SCV | Relatório | legacy123-145 | PAINEIRAS - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 155 | SCV | Relatório | legacy123-149 | PALMEIRAS - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 109 | SCV | Relatório | legacy123-103 | PARQUE DAS NAÇÕES - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 264 | SCV | Relatório | legacy123-260 | POLICLINICA - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 101 | SCV | Relatório | legacy123-94 | PRO POVO - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 178 | SCV | Relatório | legacy123-173 | PRODUCAO_AGENTE | Não | sql | Legado 14 · Firebird local · terminal eSUS | — |
| 340 | SCV | Relatório | legacy123-414 | RANKING POR TIPO DE RESPOSTA | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 341 | SCV | Relatório | legacy123-415 | RANKING POR TIPO DE RESPOSTA | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 342 | SCV | Relatório | legacy123-416 | RANKING POR TIPO DE RESPOSTA | Não | sql | Legado 21 · Firebird robô NAS · consultas de campanhas | — |
| 268 | SCV | Relatório | legacy123-265 | RELATORIO DE CONSULTAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 282 | SCV | Relatório | legacy123-282 | RELATORIO DE CONSULTAS - CM CAROBEIRAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 281 | SCV | Relatório | legacy123-281 | RELATORIO DE CONSULTAS - CM CECAP | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 279 | SCV | Relatório | legacy123-279 | RELATORIO DE CONSULTAS - CM COLINAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 276 | SCV | Relatório | legacy123-276 | RELATORIO DE CONSULTAS - CM JARDIM MARIN | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 287 | SCV | Relatório | legacy123-287 | RELATORIO DE CONSULTAS - CM NINA | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 278 | SCV | Relatório | legacy123-278 | RELATORIO DE CONSULTAS - CM PALMEIRAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 285 | SCV | Relatório | legacy123-285 | RELATORIO DE CONSULTAS - CM PARQUE DAS NACOES | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 269 | SCV | Relatório | legacy123-266 | RELATORIO DE CONSULTAS - CM PRO POVO | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 283 | SCV | Relatório | legacy123-283 | RELATORIO DE CONSULTAS - CM SAO COSME | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 277 | SCV | Relatório | legacy123-277 | RELATORIO DE CONSULTAS - CM SAO JOAO | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 284 | SCV | Relatório | legacy123-284 | RELATORIO DE CONSULTAS - CM SIMONSEN | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 280 | SCV | Relatório | legacy123-280 | RELATORIO DE CONSULTAS - CM VILA AMERICA | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 286 | SCV | Relatório | legacy123-286 | RELATORIO DE CONSULTAS - CM VILA PAES | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 316 | SCV | Relatório | legacy123-321 | RELATORIO DE CONSULTAS - DENGARIO | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 274 | SCV | Relatório | legacy123-272 | RELATORIO DE CONSULTAS POR PROCEDIMENTO | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 311 | SCV | Relatório | legacy123-312 | RELATORIO DE EXAMES REGULADOS UPA-PA | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 292 | SCV | Relatório | legacy123-292 | RELATORIO GESTANTES - CM  CAROBEIRAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 293 | SCV | Relatório | legacy123-293 | RELATORIO GESTANTES - CM  PRO POVO | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 291 | SCV | Relatório | legacy123-291 | RELATORIO GESTANTES POR UNIDADE | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 289 | SCV | Relatório | legacy123-289 | RELATORIO SAIDA DE MEDICAMENTOS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 301 | SCV | Relatório | legacy123-301 | RELATORIO SAIDA DE MEDICAMENTOS -  CECAP | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 299 | SCV | Relatório | legacy123-299 | RELATORIO SAIDA DE MEDICAMENTOS -  COLINAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 298 | SCV | Relatório | legacy123-298 | RELATORIO SAIDA DE MEDICAMENTOS -  PALMEIRAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 304 | SCV | Relatório | legacy123-304 | RELATORIO SAIDA DE MEDICAMENTOS -  PARQUE DAS NACOES | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 294 | SCV | Relatório | legacy123-294 | RELATORIO SAIDA DE MEDICAMENTOS -  PRO POVO | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 302 | SCV | Relatório | legacy123-302 | RELATORIO SAIDA DE MEDICAMENTOS -  SAO COSME | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 297 | SCV | Relatório | legacy123-297 | RELATORIO SAIDA DE MEDICAMENTOS -  SAO JOAO | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 303 | SCV | Relatório | legacy123-303 | RELATORIO SAIDA DE MEDICAMENTOS -  SIMONSEN | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 300 | SCV | Relatório | legacy123-300 | RELATORIO SAIDA DE MEDICAMENTOS -  VILA AMERICA | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 305 | SCV | Relatório | legacy123-305 | RELATORIO SAIDA DE MEDICAMENTOS -  VILA PAES | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 290 | SCV | Relatório | legacy123-290 | RELATORIO SAIDA DE MEDICAMENTOS - CAROBEIRAS | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 296 | SCV | Relatório | legacy123-296 | RELATORIO SAIDA DE MEDICAMENTOS - JARDIM MARIN | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 306 | SCV | Relatório | legacy123-306 | RELATORIO SAIDA DE MEDICAMENTOS - NINA | Não | sql | Legado 17 · Oracle SIGS · prdpmv | — |
| 98 | SCV | Relatório | legacy123-91 | SANSAUDE - INDICADORES | Não | composite | Legado 8 · Firebird robô Sansaúde · 172.16.0.124 | Revisar componentes e fórmulas do relatório composto |
| 163 | SCV | Relatório | legacy123-157 | SIMONSEN - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 15 | SCV | Relatório | no-response | Sem resposta no prazo | Sim | local | — | — |
| 121 | SCV | Relatório | legacy123-115 | SÃO COSME - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 159 | SCV | Relatório | legacy123-153 | SÃO JOÃO - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 199 | SCV | Relatório | legacy123-194 | UBS CAROBEIRAS - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 183 | SCV | Relatório | legacy123-178 | UBS CECAP - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 204 | SCV | Relatório | legacy123-199 | UBS CECAP - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 189 | SCV | Relatório | legacy123-184 | UBS COLINAS - PRODUÇÃO ACS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_indicadores_esus |
| 209 | SCV | Relatório | legacy123-204 | UBS COLINAS - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 214 | SCV | Relatório | legacy123-209 | UBS DONA NINA - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 180 | SCV | Relatório | legacy123-175 | UBS GERAL - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 219 | SCV | Relatório | legacy123-214 | UBS PAINEIRAS - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 224 | SCV | Relatório | legacy123-219 | UBS PALMEIRAS - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 229 | SCV | Relatório | legacy123-224 | UBS PARQUE DAS NACOES - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 234 | SCV | Relatório | legacy123-229 | UBS PRO-POVO - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 239 | SCV | Relatório | legacy123-234 | UBS SAO COSME - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 244 | SCV | Relatório | legacy123-239 | UBS SAO JOAO - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 249 | SCV | Relatório | legacy123-244 | UBS SIMONSEN - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 254 | SCV | Relatório | legacy123-249 | UBS VILA AMERICA - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 259 | SCV | Relatório | legacy123-255 | UBS VILA MARIN - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 173 | SCV | Relatório | legacy123-167 | UBS VILA PAES - PRODUÇÃO ACS | Não | composite | Legado 3 · Firebird local · indicadores e cache hospitalar | Revisar componentes e fórmulas do relatório composto |
| 273 | SCV | Relatório | legacy123-271 | VIDAS SANSAUDE | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: PROC_ALTAS_ATE_AS_10 |
| 307 | SCV | Relatório | legacy123-308 | VIDAS SANSAUDE - METAS | Não | sql | Legado 3 · Firebird local · indicadores e cache hospitalar | Converter procedure Firebird para consulta direta no Oracle: proc_altas_ate_as_10 |
| 147 | SCV | Relatório | legacy123-141 | VILA AMÉRICA - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 113 | SCV | Relatório | legacy123-107 | VILA PAES - INDICADORES | Não | composite | Legado 9 · Firebird robô NAS/UBS · 10.2.74.70 | Revisar componentes e fórmulas do relatório composto |
| 26 | Sansaúde | Relatório | contacts | Acompanhamentos e contatos | Sim | local | — | — |
| 22 | Sansaúde | Relatório | not-sent | Agendamentos com mensagens não enviadas | Sim | local | — | — |
| 19 | Sansaúde | Relatório | confirmed | Agendamentos confirmados | Sim | local | — | — |
| 21 | Sansaúde | Relatório | not-confirmed | Agendamentos não confirmados | Sim | local | — | — |
| 23 | Sansaúde | Relatório | combined | Agendamentos não enviados / não confirmados | Sim | local | — | — |
| 20 | Sansaúde | Relatório | declined | Agendamentos recusados | Sim | local | — | — |
| 27 | Sansaúde | Relatório | legacy-stock | Estoque — entrada e saída de empréstimos | Não | oracle | — | Definição identificada no servidor 172.16.0.124; vínculo com esta unidade, consulta e conta de leitura ainda precisam de homologação. |
| 25 | Sansaúde | Relatório | failures | Falhas e bloqueios de comunicação | Sim | local | — | — |
| 24 | Sansaúde | Relatório | no-response | Sem resposta no prazo | Sim | local | — | — |


## Atualização de 24/10/2026: Painel Leitos local

Por decisão do usuário, o envio de `scv / legacy123-309` passa a obter exclusivamente o PDF inserido manualmente em `/opt/orbita/files/reports/painel-leitos/painel-leitos.pdf`. Fonte `external_file`, handler `external_pdf_v1`, versão 2, sem conexão Firebird/Oracle nesse fluxo. Nenhum gerador legado foi executado ou alterado.

O cadastro está revisado/habilitado, mas a prontidão bloqueia novas solicitações enquanto o arquivo estiver ausente/inválido. Arquivo real ausente ao finalizar; nenhum PDF fictício foi publicado na pasta operacional. Permissões preservadas: 19 vínculos, nenhum manual ativo. Nenhuma programação habilitada. Autorizar destinatários individualmente na interface.

PDF limitado a 7 MiB, 1 a 200 páginas, sem senha; caminho fixo, leitura somente no volume existente. Cópia protegida e hash por execução; substituição posterior preserva resultados prontos, sob as mesmas revalidações de autorização. Atualização de conteúdo/dados permanece responsabilidade da publicação manual.

121 testes isolados aprovados. Build e atualização de api/worker/scheduler concluídos; API saudável, endpoint autenticado do cadastro respondeu 200, Django check e migrate --check aprovados. Baileys não foi reiniciado por esta tarefa. Sem mensagens reais de validação. Documentação: `docs/relatorios/PAINEL_LEITOS_PDF_LOCAL.md`. Backup: `/opt/backups/orbita/painel-leitos-local-20261024-135835/`. Aceite de envio real pendente.


Atualização em 24/10/2026, 11:08 BRT: por solicitação do usuário, copiado o PDF existente mais recente (criação do documento: 23/10/2026, 01:01:21 BRT), de `comparacao_2026-10-23/Painel_Leitos__PAINEL_LEITOS.pdf` nas evidências para `/opt/orbita/files/reports/painel-leitos/painel-leitos.pdf`. Validado pelo leitor real do backend: 1 página, 226.260 bytes, nenhuma pendência de prontidão. A data do documento não comprova atualidade dos dados. Nenhuma mensagem enviada ou permissão alterada; autorização dos destinatários e aceite no aparelho continuam pendentes. Evidência: `/opt/backups/orbita/painel-leitos-local-20261024-135835/pdf-publication.json`.


## Atualização — snapshots de leitos (24/10/2026)

Implementação publicada no remoto. Ler `docs/relatorios/SNAPSHOTS_LEITOS.md`. Migration operations.0024; modelos ReportSnapshotConfiguration, ReportSnapshotRun, BedSnapshotRow; serviços bed_snapshots.py e snapshot_api.py. A subaba Relatórios → Coletas administra coleta e histórico, sem transportar mensagens.

Coleta 1 (bed-position-daily), componente 354 (bed-position-oracle), conexão Oracle HML 19; calendário diário às 04:20:23, janela 60 min, habilitado. Relatório 310 (legacy123-311) usa handler bed_snapshots_v1, fonte local PostgreSQL e XLSX, parâmetros WPA_DATA_INICIAL / WPA_DATA_FINAL inclusivos. Danilo -- STI (112) autorizado manualmente. Não há programação automática desse relatório habilitada.

Primeira snapshot: 24/10/2026 às 11:33:26 de Brasília, manual, 15 unidades de internação, 219 leitos, ambiente homologation. Run 6e82811b-7682-4898-955d-f018293a459e. Exportação de painel 08aa45b1-a3d1-4617-9ad7-7d2dd9492ea3 gerada e baixada, sem destinatário/entrega. XLSX mantém quatro colunas e data Excel. O histórico anterior não foi importado; não fabricar posições históricas com dados atuais nem misturar HML e produção.

17 testes novos e 138 testes relacionados aprovados; builds e OpenAPI validados. Evidências e backup em /opt/backups/orbita/bed-snapshots-20261024/. Não foi feito commit das alterações desta entrega.


## Atualização — importação do histórico real de leitos

Em 24/10/2026, foram extraídos diretamente de LEITOS_SISTEMA, Firebird 172.16.0.123, os dados de 24/09 a 23/10: 28 dias/390 registros. Não há dados em 04/10 e 10/10 nem na tabela derivada. Importação concluída no PostgreSQL: 30 runs históricos (origin=legacy), 28 ready e dois missed, sem linhas fictícias, com captura/programação históricas nulas. Origem de produção separada da coleta HML de 24/10. Reimportação validada sem duplicidades.

Ler docs/relatorios/IMPORTACAO_HISTORICO_LEITOS.md e backend/operations/legacy_bed_snapshots.py. Migration 0026 torna scheduled_for anulável; 0025 de metas foi preservada. O relatório legacy123-311 continua com somente os parâmetros de início/fim: períodos históricos usam automaticamente o legado; períodos mistos HML/produção são bloqueados. Lacunas do legado são informadas em missing_dates e na interface, com XLSX contendo somente linhas reais. Exportação real acd2c835-94da-4ff3-9f59-62c2148e7cf2, download validado, sem envio. 147 testes relacionados aprovados.

Concedido SELECT em LEITOS_SISTEMA e LEITOS_DISPONIVEIS ao usuário SCV_DBEAVER_20261024. Conta/mapeamento administrativos temporários removidos, sem reinício do Firebird e sem alteração de dados hospitalares. Não guardar credenciais nestes documentos.


## Complemento — planilha original inteira

Após a confirmação do usuário, também foi importada a planilha original EXPORTAR_TABELA_LEITOS.xlsx inteira: 461 registros de 01/09 a 05/10/2026, SHA-256 06ac3d7910ba024d7d14db9df82c779a10c03dfdbceb6381009e5ed651eff6b0. Os 153 registros sobrepostos já estavam preservados; foram acrescentados 22 dias/308 registros, sem duplicação ou alteração dos dados existentes.

O histórico real consolidado no PostgreSQL passou a 698 registros/50 dias, de 01/09 a 23/10, com lacunas reais em 20/09, 04/10 e 10/10. A snapshot HML de 24/10 continua separada. A geração do relatório histórico lê exclusivamente ReportSnapshotRun/BedSnapshotRow no PostgreSQL. Oracle é apenas origem da coleta nova; a geração não acessa Oracle nem Firebird.

Verificação real: execução 634d572b-de54-450f-9a6c-23074eea4ca1 gerou 461 linhas para o mesmo período da planilha original; todas as quatro colunas e todos os valores coincidiram exatamente. As funções de consulta/conexão externa foram bloqueadas durante essa validação e não foram chamadas. Sem destinatário nem envio.

Artefatos em /opt/backups/orbita/bed-snapshots-20261024/: EXPORTAR_TABELA_LEITOS_ORIGINAL.xlsx e legacy-original-spreadsheet.json.

## Atualização de 24/10/2026: Gerenciais e Estratégicos por pasta

Por solicitação do usuário, `legacy123-162` e `legacy123-163` passam a usar PDFs publicados manualmente no SCV, como Painel Leitos. Os cadastros estão revisados/habilitados, versão 2, handler `external_pdf_v1`, sem conexão/SQL/parâmetros. As cópias existentes foram publicadas em `/opt/orbita/files/reports/indicadores-gerenciais/indicadores-gerenciais.pdf` (documento de 19/10, 8 páginas) e `/opt/orbita/files/reports/indicadores-estrategicos/indicadores-estrategicos.pdf` (documento de 22/10, 2 páginas). Não afirmar dados atuais pela data de cópia.

150 testes isolados aprovados; build e atualização de API/worker/scheduler concluídos. Geração e download autenticado dos dois PDFs validados, preservando os bytes originais. Execuções de painel sem destinatário, entrega `not_requested`; nenhuma mensagem enviada. Permissões preservadas: nenhum grant manual ativo para esses dois relatórios ao finalizar. Autorização de Danilo -- STI feita anteriormente refere-se apenas ao Painel Leitos. Nenhuma programação habilitada ou alteração nos geradores legados.

Guia: `docs/relatorios/PDFS_LOCAIS_CONTROLADORIA.md`. Backup/evidência: `/opt/backups/orbita/gerenciais-estrategicos-local-20261024-162801/`. Aceite no aparelho ainda pendente.


## Atualização — extração autenticada de SQLs e layouts (24/10/2026)

Acesso de leitura confirmado ao BASE.FDB e GLDADOS.FDB do .123 com a conta técnica autorizada. Extração ao vivo: 95 cadastros com SQL; 32 de 43 procedures com fonte textual; 8.846 componentes de layout em 233 IDs; 134 séries, 1.360 propriedades de gráficos e 1.755 faixas de cores. As três procedures principais dos indicadores continuam sem PSQL textual. SQL/layout recuperado não equivale a homologação ou ativação no SCV.

Consultar `docs/relatorios/SQLS_E_LAYOUTS_WHATSREPORT_RECUPERADOS.md` para contagens, escopo, imagens confirmadas, pendências e caminhos de evidência. Nenhuma senha incluída; nenhuma rotina de negócio executada.


## Atualização 26/10/2026 - COMPLETO TAXA OCUPAÇÃO

ID 33, scv/legacy123-20: integrado/habilitado/revisado, versão 3, handler occupancy_indicators_v1, PDF Canvas de dez páginas gerado sob demanda. Três novas consultas internas usam Oracle prdvotu (conexão 20 dedicada, somente leitura) e capacidade histórica de produção preservada no PostgreSQL, sem Firebird durante geração. Conexão HML 19 preservada. Execução 3f2ad490-57aa-479f-a94e-9502b0b40ae1, referência 26/10, ready/183 linhas/10 páginas/70s, download autenticado HTTP 200, sem entrega solicitada. 187 testes isolados aprovados. Capacidade só até 23/10, lacunas sinalizadas sem percentuais inventados; coleta futura/G4 pendente. Nenhum grant modificado, zero grants manuais ativos para este relatório, nenhuma programação habilitada, automáticos bloqueados pelo handler. Ver TAXA_OCUPACAO_ORACLE.md e /opt/backups/orbita/occupancy-integration-20261026T114918Z/.


## Prioridade e escopo - 26/10/2026

Pedido explicito: focar nos relatorios ligados as programacoes importadas. Correcao explicita do usuario: **NAO ATIVAR AS PROGRAMACOES, APENAS OS RELATORIOS**. Preservar destinatarios legados e grants; resposta anterior de manter destinatarios nao equivale a verifica-los.

50 programacoes continuam desativadas; 36 cadastros-alvo (nove relatorios ja integrados/ativos, 23 dependentes de conversao e quatro rotinas internas preservadas/bloqueadas). Prioridades e dependencias por codigo em RELATORIOS_PRIORIZADOS_DAS_PROGRAMACOES.md. 14 pendentes sao ACS/eSUS, seis estatisticas de robos, dois cargas de agenda AME e um Vidas antigo 271. Nao selecionar Oracle para substituir dados de mensagens sem prova de equivalencia.

Internacoes PS scv/legacy123-270 (ID 272) ativado/revisado, versao 2, handler external_pdf_v1, fonte fixa /opt/orbita/files/reports/internacoes-ps/internacoes-ps.pdf. PDF copiado do arquivo legado preservado, paginas=1, datas 16 e 17/04/2026; arquivo historico, nao apuracao atual. Geracao e download autenticado originais validados (execucao c55dfeab-1af6-4535-a5ca-280fb57549bf, ready, not_requested). 72 testes aprovados. SHA de configuracoes de programacoes, canais, grants e destinatarios comparado antes/depois: inalterado. Evidencias /opt/backups/orbita/prioridade-relatorios-programados-20261026T141526Z/.
