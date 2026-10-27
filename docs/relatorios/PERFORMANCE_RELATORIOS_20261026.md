# Desempenho das listagens de relatorios - 26/10/2026

Queixa do usuario: lentidao geral. Diagnostico inicial no servidor: memoria disponivel ~5 GB; disco com ~9 GB livres; inventario 0,029s e Canvas 50 0,151s. O gargalo medido foi nas listagens autenticadas: relatorios 7,912s/129 consultas e programacoes 14,684s/288 consultas.

Causas e correcoes:

- Canvas recalculava a mesma assinatura de fonte repetida por cada dataset do mesmo relatorio. Agora cada definition_snapshot calcula uma vez por fonte; todos os aliases/datasets continuam validados e cada chamada posterior refaz a fotografia.
- Validacao de imagem da fotografia carregava bytes completos. Agora le somente ID/SHA para a fotografia; exportacao continua carregando as imagens e validando propriedade/unidade.
- Programacoes repetiam readiness por relatorio em cada linha. Reuso limitado ao contexto de uma unica resposta, com listas independentes; autorizacao, grants e validacoes posteriores permanecem atuais. Joins incluem unidade do relatorio.
- O parse estrutural de SQL era repetido mesmo para consultas identicas. Cache LRU de 128 estruturas, por texto integral e dialeto, guarda apenas o resultado imutavel da validacao sintatica e nomes de binds. Schema, declaracoes de parametros, estado de banco, acesso e resultados nao sao cacheados. SQL alterado e novo processo fazem novo parse; erros nao sao armazenados.

Medicao com codigo corrigido (mesmos endpoints e dados): primeira passagem relatorios 1,824s, programacoes 0,989s; segunda passagem 1,035s e 0,719s. Consultas reduzidas para 91 e 69, respectivamente. Medicoes via APIClient autenticado no servidor; nao representam tempo total de rede/renderizacao do navegador.

106 testes backend aprovados, mais verificacao isolada do cache SQL aprovada. Cobertura inclui invalidacao por versao/conexao/imagem, referencias de dataset invalidas mesmo quando a assinatura e reutilizada, permissao entre unidades e schema de parametros atualizado entre chamadas. Nenhuma programacao/canal/permissao foi ativada e nenhuma mensagem foi enviada.

Backup, testes, antes/depois e validacao publicada em /opt/backups/orbita/report-performance-20261026T200801Z/. Publicacao restrita a api/worker/scheduler; sem rebuild ou reinicializacao do Baileys.
