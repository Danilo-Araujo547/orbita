# Portabilidade dos relatórios para Canvas

Conversão aditiva de layouts, sem habilitar relatórios, mensagens ou programações. A definição anterior continua sendo o gerador ativo enquanto `canvas_enabled` for falso. O botão Canvas abre o layout portado com fontes e blocos editáveis.

## Escopo

- 24 relatórios operacionais nas unidades AME, SCV e Sansaúde: confirmação, recusa, não confirmados, não enviados, combinação, ausência de resposta, falhas e contatos. Usam `local_report_data`, compartilhado com o gerador anterior, preservando os filtros e o isolamento de unidade.
- Indicadores Médicos: capa, permanência média, permanência por especialidade, exames por atendimento, exames e atendimentos, pareceres mensais/diários e encerramento. São sete páginas e oito conjuntos de dados. Reutiliza a coleta Oracle existente em uma transação de leitura; agrega uma única vez por prévia. Médias ponderadas, 13 competências, totais anuais, oito dias de exames/atendimentos, dez dias de pareceres e conversão para HH:MM:SS mantidos. Imagens originais armazenadas como ativos privados do relatório.
- Estoque: tabela editável com fornecedor, tipo, data, código, produto, unidade, quantidade, estoque atual e localização. Preserva validação do período; relatório permanece desativado. A tabela do Canvas é uma apresentação nova; agrupamentos e totais especializados do PDF antigo não devem ser considerados homologados automaticamente.
- Exportar Tabela Leitos: dados dos mesmos snapshots escolhidos pelo exportador atual. Não mistura histórico de produção com homologação e preserva a validação de lacunas. O XLSX do Canvas usa a grade e abas de dados completos; não promete a formatação idêntica do arquivo antigo.

Os relatórios portados ficam como rascunhos, para revisão da apresentação. A coleta e os cálculos possuem testes, mas cores condicionais e a apresentação especializada do PDF médico anterior não são automaticamente equivalentes. As fontes podem ser editadas no modal de fonte; o conjunto de dados é selecionável. A prévia faz a leitura real; abrir o editor não consulta Oracle.

## Pendências explícitas

Indicadores Gerenciais (legacy123-162), Indicadores Estratégicos (legacy123-163) e Painel Leitos (legacy123-309) são PDFs já montados e publicados na pasta de arquivos. Sem os documentos/layouts e fontes que produziram esses PDFs, não existe uma conversão fiel de seus elementos internos para blocos. Permanecem com o gerador anterior e aviso no editor. Não foram rasterizados para simular edição de dados.

Os demais relatórios legados ainda não integrados dependem do mapeamento/validação de suas fontes; abrir um Canvas vazio não significa que foram portados. Rascunhos personalizados existentes, incluindo Vidas Sansaúde, são preservados.

## Aplicação e reversão

`python manage.py port_report_canvas` apresenta a seleção sem alterar registros. `--apply --backup /caminho/arquivo.json` grava os layouts, incrementa versão e audita cada relatório. Reexecução é idempotente pela versão da conversão. Não sobrescreve layouts personalizados ou ativos e adia relatórios com execução em andamento. Os backups ficam fora da árvore do projeto em /opt/backups/orbita/canvas-port-20261025.

A ativação do Canvas é uma ação separada no editor. As restrições de geração automática dos Indicadores Médicos e de Estoque continuam vigentes mesmo com Canvas ativo. Para voltar ao gerador anterior, desmarcar Usar Canvas; para desfazer apenas a importação de layout, restaurar a definição específica do backup com controle de versão e auditoria, sem restaurar o banco inteiro sobre dados novos.

## Implementação

`report_canvas/native.py`: adaptadores de dados calculados e locais. `report_canvas/ports.py`: layouts iniciais. `port_report_canvas`: conversão controlada. `report_canvas/sources.py`: resolução, validação e assinatura das dependências. `reports.local_report_data`: filtros compartilhados. Fontes usam o mesmo contrato `report`, com `dataset` para conjuntos de dados registrados; não há SQL arbitrário no editor.

## Resultado aplicado — 25/10/2026

27 layouts portados (24 operacionais, Estoque, Médicos, Histórico de Leitos), todos com Canvas desativado. Três PDFs externos e demais fontes não integradas permanecem pendentes. Indicadores Médicos: versão 5 após ajuste de larguras das colunas e contraste da capa. Prévia real na homologação com referência 23/10/2026: PDF de sete páginas, XLSX de 11 abas e 105 linhas derivadas nas fontes. A atualização apresentada é a menor data efetivamente disponível na homologação (28/08/2026), sem presumir igualdade com produção.

Regressão ampliada: 234 testes aprovados. Após incluir validação de larguras e proteção de conjuntos de dados, suíte Canvas/portabilidade: 36 testes aprovados; há sobreposição entre as suítes. Build frontend aprovado e contêineres publicados. QA autenticado confirmou sete páginas, 25 blocos, oito conjuntos selecionáveis e capa/texto editáveis. Nenhuma execução ou mensagem criada pela conversão e pelas prévias.
