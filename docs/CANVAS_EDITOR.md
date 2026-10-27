# Editor de Canvas

Abra um relatório em **Relatórios → Canvas**. A folha representa a exportação;
selecione um bloco para editar conteúdo, dados, aparência e posição no inspetor.
Escolha PDF ou XLSX e confira **Prévia** antes de salvar. Alterações de campos
não são salvas automaticamente no servidor. **Salvar** grava o rascunho;
ativar troca o gerador do relatório e exige uma configuração válida.

## Fontes e colunas

Em **Dados**, adicione uma fonte: relatório da mesma unidade, tabela manual ou
metas mensais. O vínculo segue **fonte → conjunto de dados → coluna**.
Use um nome curto para identificar a fonte; renomear seu identificador atualiza
os blocos ligados. Confira os usos antes de remover uma fonte.

A prévia da fonte consulta dados somente quando solicitada. **Exemplo** identifica
dados sintéticos; a prévia real informa a quantidade de linhas. O painel de dados
mostra tipos, nulos e amostras. Texto parecido com data/número continua sendo texto;
a sugestão de tipo não altera a origem. Uma fonte pode estar indisponível por falta
de parâmetros, conexão, permissão, desativação ou mudança do relatório de origem.

Tabelas manuais aceitam colagem TSV/CSV com cabeçalho. Nomes de colunas podem ter
acentos e espaços, até 100 caracteres. Cabeçalhos duplicados na importação recebem
sufixos; importações acima de 100 colunas ou 2.000 linhas são rejeitadas inteiras.
Não há truncamento silencioso. JSON manual com colunas duplicadas é inválido.

## Gráficos

Escolha a coluna X e até seis séries numéricas Y. Valores nulos não viram zero;
pizza rejeita negativos. Números não finitos e somas que excedem o limite numérico
são rejeitados. Gráficos aceitam até 500 pontos após agrupamento.

Para datas, use valores ISO (`2026-10-27` ou `2026-10-27T14:30:00-03:00`).
Agrupe por dia, semana, mês, trimestre ou ano; semanas começam na segunda-feira.
O dia escrito no ISO é preservado, sem conversão para o fuso do navegador.
Datas nulas são ignoradas; datas impossíveis são rejeitadas. Soma, média,
contagem, mínimo e máximo consolidam os grupos. Também é possível agregar
categorias repetidas sem agrupamento de data.

Gráficos antigos conservam suas cores legadas. A nova paleta só é gravada
explicitamente em gráficos novos/configurados. Consulte as limitações do XLSX
nas notas técnicas antes de depender de cores na planilha.

## Texto e imagens

Texto aceita `{{report_name}}`, parâmetros e referências suportadas pela fonte.
Variáveis inexistentes continuam literais. HTML é texto, inclusive `<script>`.
A prévia PDF deve ser conferida para altura disponível e cobertura dos caracteres
pela fonte: emoji pode não ter glifo no PDF; XLSX preserva Unicode e quebras.

Envie PNG/JPEG de até 2 MiB e 16 megapixels. O servidor valida o conteúdo,
independentemente da extensão. Remover uma imagem da biblioteca do editor não
apaga o arquivo do servidor; confira vínculos de blocos antes de remover usos.

## Desfazer, teclado e Problemas

Desfazer/refazer mantém até 100 passos, incluindo trocas de fonte/tipo e arraste.
Salvar marca a revisão; desfazer depois de salvar volta a marcar alterações pendentes.

| Tecla | Ação |
|---|---|
| Tab / Shift+Tab | Percorrer controles e blocos na ordem do documento |
| Ctrl/Cmd+Z | Desfazer |
| Ctrl/Cmd+Shift+Z ou Ctrl/Cmd+Y | Refazer |
| Ctrl/Cmd+S | Salvar (não usar em relatórios reais no staging) |
| Ctrl/Cmd+D | Duplicar bloco selecionado |
| Setas / Shift+setas | Mover 1 / 10 px |
| Delete / Backspace | Remover bloco selecionado |
| Escape | Limpar seleção / fechar a interação atual |
| Ctrl/Cmd+[ / ] | Alterar ordem do bloco |
| Ctrl/Cmd+\ | Alternar painéis |
| Ctrl/Cmd++ / - / 0 | Zoom do editor / 100% |
| Shift+1 | Ajustar à largura |
| ? | Abrir atalhos |

Dentro de inputs, os atalhos de edição pertencem ao campo; Ctrl/Cmd+S salva o
Canvas fora de modais. Modais não devem salvar o formulário ao fundo.

Abra **Problemas** e selecione um item para localizar o bloco. Corrija os erros
antes de ativar ou gerar a prévia. Rascunhos podem omitir escolhas de coluna;
referências inválidas de fonte/imagem e violações do schema continuam bloqueadas.

O navegador pode oferecer recuperação local de layout alterado. Ela não salva no
servidor e não inclui as linhas de prévias consultadas. Linhas manuais fazem parte
do próprio layout. Não use um navegador compartilhado para layouts confidenciais.

## Limites

| Recurso | Limite |
|---|---|
| Blocos / fontes / páginas / imagens | 100 / 30 / 30 / 20 |
| Layout JSON UTF-8 | 750.000 bytes (750 KB), incluindo linhas manuais |
| Tabela manual | 100 colunas × 2.000 linhas, sujeito ao tamanho do layout |
| Fontes consultadas na exportação | 30.000 linhas e 10 MiB no total |
| Gráfico | 500 pontos após agrupamento / 6 séries |
| Texto por bloco / título | 20.000 / 300 caracteres |
| Página / bloco mínimo | 150–3.000 px por dimensão / 20×20 px |
| Imagem | 2 MiB recebidos / 16 MP / 4 MiB após conversão para PNG |
| Arquivo exportado | 7 MiB |
| Rascunho local | 700 KiB |

Os limites se combinam: uma tabela nas dimensões máximas pode ultrapassar 750 KB
conforme o conteúdo das células. Reduza linhas/textos ou use fonte de relatório.
