# Descrições dos relatórios e componentes

Em cada modal Editar, a seção Sobre o relatório/componente apresenta objetivo, origem, montagem, componentes, rotinas vinculadas, snapshots e pendências.

A descrição é derivada da definição atual, sem executar SQL ou abrir conexão externa. A consulta do catálogo considera somente a unidade autorizada. Detalhes internos são retornados apenas à administração, assim como Caminho dos dados e SQL. Credenciais não entram no texto.

Adaptadores nativos possuem explicações específicas: Indicadores Médicos, Exames por atendimento, Vidas Sansaúde, histórico de leitos, empréstimos de estoque, PDFs publicados e relatórios operacionais. Nos demais, usam-se conexão atual, fontes identificáveis no SQL e componentes cadastrados. Caminhos e rotinas legados são explicitamente separados da execução atual. Não identificar um snapshot não significa provar sua inexistência.

Horários, dias, ambiente e ativação das coletas vêm do cadastro ReportSnapshotConfiguration. Programações de envio ativas são sinalizadas sem repetir destinatários; os detalhes ficam em Programações. Nenhuma rotina ou envio é habilitado por esta mudança.

API: technical_description, somente leitura, em /api/v1/reports/. Tipagem compartilhada ReportTechnicalDescription. Definições futuras recebem automaticamente o mesmo resumo; não há cópia de textos que se desatualize ao editar a configuração.

Validação: 62 testes de descrições e catálogo; testes de isolamento, privacidade, origem atual versus legado, rotinas não confirmadas e horários de coleta. Evidências em /opt/backups/orbita/report-descriptions-20261026/.


## Edição manual

O modal Editar contém o campo Descrição, preenchido inicialmente com o mapeamento automático. O administrador pode alterar o texto e salvar no mesmo botão do cadastro. O texto é preservado em legacy.report_description, sem substituir outras evidências do legado. Uma descrição vazia salva permanece vazia. Depois do primeiro salvamento, alterações automáticas de conexão não sobrescrevem o texto manual.

API: description (texto, até 16.000 caracteres). Criação e revisão seguem permissões administrativas, versão, idempotência e auditoria do cadastro existente. technical_description continua disponível como referência técnica derivada e somente leitura. Nenhuma migration é necessária.

Validação da edição: 66 testes aprovados, incluindo persistência de texto, preservação das evidências legadas, limite de tamanho, campo vazio e conflito de versão. Campo conferido nos 360 cadastros; maior texto inicial: 3.739 caracteres. Smoke pela API publicado, sem escrita de teste no banco de produção.

Posicionamento: campo Descrição no fim do modal, depois das seções de origem/legado, em seção expansível inicialmente recolhida. O botão Salvar continua no rodapé fixo.
