# Interface do Órbita

- Cadastros e configurações começam por um botão “Adicionar”, “Configurar” ou “Editar”. Os campos só aparecem após essa ação, em modal ou formulário dedicado.
- Não deixar formulários de cadastro ou edição abertos nas telas principais. Não salvar configurações automaticamente ao sair de um campo.
- Nas telas principais, mostrar registros, resumos, estados e ações. Inputs de busca e filtros de consulta podem permanecer visíveis.
- Reutilizar `FormAction` e `InlineDialog`, preservar validações e mensagens de erro e fechar o modal somente após sucesso confirmado.
- Priorizar desktop, temas claro/escuro/sistema e textos funcionais, sem frases promocionais.
- Evitar explicações permanentes, avisos genéricos e subtítulos que repetem o título. Manter rótulos, estados, erros e confirmações relevantes. A ajuda da barra lateral deve abrir somente a documentação da tela atual; instruções detalhadas ficam nessa documentação.
- Configurações e administração devem priorizar listas de registros existentes, com estado e ações por registro. Novos cadastros usam botões compactos no cabeçalho; evitar cartões grandes de ação, ícones decorativos repetidos e setas sem função. O tema usa um único botão que alterna claro, escuro e sistema.
- Nos modais, usar `InlineDialog`: cabeçalho e ações na prop `footer` ficam fora do corpo rolável. Ao mover submit para o rodapé, associar ao formulário por `id`/`form`. Manter grids e fieldsets com `min-width: 0`; não aplicar estilos de inputs de texto a checkbox ou radio; evitar padding duplicado em `FormAction`.
- A seleção de unidade deve existir somente no topo da barra lateral. Não repetir seletores no cabeçalho, filtros ou ações da lista de unidades.


## Ambiente de trabalho

- Work exclusively on the remote server root@172.16.0.59, project /opt/orbita. Do not develop or synchronize a local checkout unless the user explicitly changes this instruction.
- Preserve the login customized on this server and the existing runtime configuration and encrypted credentials.
