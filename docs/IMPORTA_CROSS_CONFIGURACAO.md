# Modelos e templates do Importa CROSS

Na unidade selecionada, abra Configurações → Importa CROSS · modelos e templates.
Use Adicionar modelo ou Editar para criar uma revisão. Selecione o formato, o template da unidade e o campo padronizado de cada parâmetro {{1}}, {{2}} etc. O modal apresenta o conteúdo do template. Mapeie também as colunas da planilha para os 12 campos padronizados e salve o modelo validado.

Em Importa CROSS → Importar planilha, escolha o modelo e o arquivo. O template, os parâmetros e as colunas são os salvos na configuração; o resumo desta tela é somente leitura. Sem template configurado, a geração da prévia fica indisponível. Alterações no modelo não reescrevem importações existentes: cada prévia preserva sua configuração.

Gerar prévia não confirma a importação nem libera envio. Confirmar importação cria registros e rascunho de comunicação; o envio tem autorização separada. Vários telefones preservam um único registro de origem e geram destinatários separados.

## Controle das importações

Cada arquivo começa desativado. A lista apresenta o total de registros, ativos/desativados, mensagens enviadas e na fila. Ver registros abre um modal paginado, com busca, seleção por página e ativação/desativação individual ou dos selecionados. Vários contatos pertencem a um único registro.

Ativar confirma uma prévia válida quando necessário e agenda os envios para 30 minutos após a ação. Os itens entram imediatamente na fila com essa data futura. A operação não despausa a unidade, não altera o modo de envio nem amplia os destinatários autorizados. Erros de validação e ausência de template impedem a ativação. Repetir uma ativação já ativa não muda sua programação.

Desativar a importação ou um registro cancela somente mensagens ainda sem tentativa. Envios já iniciados podem concluir. Reativar usa as mesmas mensagens; mensagens tentadas, enviadas, com falha ou resultado incerto não são reenviadas automaticamente. Ao reativar um registro de um lote ativo, seus itens pendentes recebem no mínimo mais 30 minutos. Alterações concorrentes exigem a versão atual; divergências retornam 409. As ações ficam na auditoria.

## Aviso de envio recente

A categoria corresponde ao nome do modelo de importação, preservado entre versões, combinado com sua finalidade. O aviso destaca reconhecimento da Meta (aceita/enviada/entregue/lida) em menos de 30 dias; simulações, filas, falhas e resultados incertos não contam. É um aviso: não desativa automaticamente o registro.

A correspondência usa o código de paciente quando a origem o fornece (Ausentes). Quando a planilha só identifica a entrada na fila, usa o código do registro dentro da mesma categoria. Nome ou telefone compartilhado não estabelecem identidade. Por isso, outro atendimento do mesmo paciente com código diferente pode exigir revisão manual. O filtro de envios recentes e os controles dos selecionados permitem revisar e excluir esses registros do lote sem apagar o histórico.

O transporte continua respeitando a unidade, as permissões, o modo de teste, a lista autorizada e os limites diários existentes. Templates com parâmetros BODY são suportados; componentes variáveis de cabeçalho/mídia/URL e Flows sem contrato de parâmetros permanecem bloqueados.
