# Migração dos geradores para Canvas — 25/10/2026

Os 24 relatórios operacionais locais (AME, SCV e Sansaúde), Indicadores Médicos, Estoque – entrada e saída de empréstimos e Exportar tabela leitos passam a ser gerados pelo Canvas. O relatório de estoque continua desativado; não se alteram destinatários, permissões, conexões, queries, parâmetros, automações ou controles de transporte.

A coleta de dados permanece nos adaptadores existentes, somente de leitura. O layout e a exportação PDF/XLSX são feitos pelo motor Canvas. Indicadores Médicos usa as imagens cadastradas como assets da unidade e fontes de dados separadas por componente. Estoque tem detalhes e resumo com subtotais e total geral; o saldo incompleto é explicitado e a query é compartilhada entre os blocos. Leitos mantém uma única planilha com quatro colunas, sem títulos intermediários, com faixas por data.

## Aplicação e reversão

`activate_report_canvas` valida os parâmetros, fontes, assets e exportação antes de ativar cada definição. Usa bloqueio de linha, impede troca durante execuções pendentes/em andamento e preserva layouts já editados. A segunda aplicação é idempotente. Arquivos de conferência ficam restritos no backup; nenhuma execução ou mensagem é criada pelo comando.

Backup anterior, parâmetros de validação, arquivos de prévia, testes e logs: `/opt/backups/orbita/canvas-migration-20261025/`. O JSON conserva o layout, ativação e versão anteriores. Para reverter uma definição, conferir sua versão atual e execuções em andamento, restaurar os campos Canvas do backup, incrementar a versão e registrar auditoria. Não reduzir versões nem restaurar o banco inteiro.

## Pendências

Indicadores Gerenciais (168), Estratégicos (169) e Painel Leitos (308) recebem PDFs externos prontos. Não foram convertidos em imagens estáticas para simular um relatório editável. Continuam com o encaminhamento original até reconstruirmos a origem e o layout. Relatórios SQL ainda não revisados/validados continuam desativados; componentes de coleta não são relatórios finais e não passam pelo renderizador.

## Validação

Prévia em dados reais: todos os 27 arquivos foram gerados, sem transporte WhatsApp. Indicadores Médicos e Estoque usam Oracle de homologação; Leitos utiliza um período contínuo do histórico real importado, sem misturar homologação e produção. Conferidos visualmente PDFs médicos e estoque, e testada a estrutura XLSX de leitos. A validação de exportação não substitui homologação clínica/financeira dos dados da origem.
