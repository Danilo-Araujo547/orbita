# Indicadores Médicos — Oracle direto

## Ambiente e cadastro

- Servidor SCV: 172.16.0.59, projeto /opt/orbita.
- Unidade do catálogo: SCV. Código preservado: legacy123-40.
- Oracle de homologação: 172.16.3.254:1521/hmlvotu.
- Conexão cadastrada em Relatórios > Conexões extras, com senha criptografada pelo mecanismo existente de envelope do serviço. A instalação usa segredo de embrulho aleatório descartável quando não informado o segredo administrativo; alterações pela interface continuam exigindo autenticação do administrador. Nenhuma senha consta deste documento ou dos SQLs.
- Geração manual no painel. Este relatório bloqueia envio a destinatários, origem WhatsApp e execução automática nesta fase. Programações preexistentes permanecem desativadas.

## Conteúdo e arquivos

Pasta persistente no servidor: `/opt/orbita/files/reports/indicadores-medicos/v1/`.
Montagem somente leitura nos serviços: `/app/files/reports/indicadores-medicos/v1/`.

- first-background.png e last-background.png: artes originais extraídas do PowerPoint fornecido.
- first-background.jpg e last-background.jpg: cópias comprimidas para incorporação no PDF.
- logo.png: identidade visual.
- arial.ttf e arialbd.ttf: tipografia do layout.
- layout.json: ordem das especialidades e limites de cores extraídos do layout legado.

A pasta contém apenas arquivos estáticos. Dados de pacientes e resultados não são publicados como arquivos estáticos. O PDF continua armazenado na execução protegida do catálogo, com download autorizado pela API existente.

## Consultas cadastradas

| Código | Dados | Referência inicial |
|---|---|---|
| medical-stays | Permanência por mês, convênio e especialidade | operations/report_sql/indicadores_medicos/stays.sql |
| medical-attendances | Quantidade de atendimentos por dia | operations/report_sql/indicadores_medicos/attendances.sql |
| medical-exams | Quantidade de exames por dia | operations/report_sql/indicadores_medicos/exams.sql |
| medical-opinions-months | Pareceres de urgência por mês/especialidade | operations/report_sql/indicadores_medicos/opinions_months.sql |
| medical-opinions-days | Pareceres de urgência por dia/especialidade | operations/report_sql/indicadores_medicos/opinions_days.sql |

O SQL executado vem do cadastro no banco do SCV. Os arquivos SQL são as definições iniciais versionadas. Os componentes são internos à composição, sem solicitação manual independente.

## Períodos e regras

`data_referencia`: AAAA-MM-DD, opcional no formulário. Em branco, fixa a data atual da unidade na criação da execução. São utilizados dados anteriores a essa data, com fim exclusivo à meia-noite.

A consulta começa em 1º de janeiro do ano anterior. O PDF apresenta os dois anos, 13 meses e as janelas diárias do layout. Permanência é ponderada por quantidade de altas, não média simples de médias. Razão exames/atendimentos usa totais separados e permanece sem valor se não houver denominador. Pareceres mantêm arredondamento por registro em 3 casas, média em 5 e conversão para segundos do legado.

As cinco consultas utilizam uma única conexão e transação Oracle `SET TRANSACTION READ ONLY`. Não são chamadas procedures legadas, nem consultado o Firebird. O relatório inclui capa, cinco páginas de indicadores e encerramento. Cabeçalho e rodapé ficam apenas nas páginas internas. A data exibida no cabeçalho é a menor das últimas datas encontradas nas quatro fontes; não atesta, isoladamente, completude de carga na origem.

## Segurança e rastreabilidade

A composição mantém os controles existentes de unidade, usuário e permissões. O histórico de configuração anterior fica em `legacy.migration.previous_definition`. Cada execução captura a data de referência, versão do relatório, versões das cinco definições e da conexão, hashes das artes e datas observadas nas fontes. Alterações de definições/arte invalidam execuções anteriores para nova consulta/download. Para mudar o layout, criar uma nova versão e revisar os hashes.

A implantação não altera programações ou conexões dos demais relatórios. Os testes utilizam dados fictícios e transporte desativado. O aceite atual é em homologação; produção exige validação específica.

## Operação

Em Relatórios, selecionar unidade SCV, localizar INDICADORES MEDICOS (legacy123-40) e gerar pelo painel. Data de referência opcional em AAAA-MM-DD. As consultas e a conexão podem ser inspecionadas nos respectivos cadastros.

O comando `python manage.py configure_medical_indicators --unit scv` realiza o cadastro inicial com credenciais recebidas por variáveis de ambiente. Recusa executar novamente sobre cadastro já configurado para não sobrescrever alterações do administrador. Não inclui senhas no código nem imprime credenciais.

## Evidência de aceite técnico em homologação — 23/10/2026

- Cadastro do relatório: ID 50, código legacy123-40, unidade SCV.
- Conexão: ID 19. Cinco componentes SQL cadastrados.
- Execução: cc3eddc3-4d06-400c-bf8a-8972763371b7.
- Resultado: ready, 3.280 linhas agregadas, 17,36 segundos, PDF de 7 páginas e 2.020.488 bytes.
- API de download: HTTP 200, application/pdf. Acesso público ao catálogo permanece HTTP 401.
- Transporte: not_requested; destinatário ausente. Nenhuma mensagem enviada.
- Últimos registros observados: altas médicas 28/08/2026, atendimentos 28/08/2026, pareceres 28/08/2026, exames 29/08/2026.
- As fontes médicas da homologação estão anteriores à data de geração. Não confundir data de geração com atualização da base.
- Regressão do catálogo/WhatsApp/médicos: 67 testes aprovados. Reexecução dos 6 testes médicos com renderização real das 7 páginas: aprovada.
- PDF renderizado em PNG e conferido visualmente nas sete páginas.
- Logs técnicos: /opt/backups/orbita/medical-tests.log, medical-render-tests.log e medical-e2e.log.
- PDF de validação: /opt/backups/orbita/INDICADORES_MEDICOS_ORACLE_HML.pdf.

Aceite técnico em homologação concluído. Aceite do usuário e validação em produção pendentes.
