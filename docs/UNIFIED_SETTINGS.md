# Configurações unificadas

A rota `/configuracoes` concentra as opções antes distribuídas entre Configurações, Administração e Usuários. As URLs `/administracao` e `/usuarios` continuam abrindo Configurações.

A tela exibe uma lista por grupo: Instância, Integrações, Operação, Cadastros e Monitoramento. Cada opção abre os registros existentes em modal. Novo/Adicionar e Editar abrem os respectivos formulários. Nenhuma configuração é gravada por abrir ou fechar a seção.

## Acesso

As permissões existentes continuam independentes no backend:

- `settings`: integrações, lembretes, controle de envios, importações, auditoria e logs.
- `operationsAdmin`: origens, preparos, layouts, prazos e cadastros de relatórios.
- `users`: usuários e suas concessões de acesso.

A entrada Configurações fica visível quando houver acesso a pelo menos uma dessas áreas. Cada item verifica sua permissão original. Unidades usa as concessões aceitas pela API existente. Leitura não habilita edição. Usuários, unidades e cadastros administrativos locais não são oferecidos em unidades remotas.

O formulário de usuários identifica as permissões como Configurações · Integrações e envios, Configurações · Cadastros e Configurações · Usuários, sem mudar as chaves persistidas.

## Modais

A lista permanece atrás do modal da seção. O formulário pode abrir sobre essa seção. Apenas o modal superior captura Escape e Tab; ao fechar todos os modais, a rolagem anterior é restaurada. Cabeçalhos e rodapés permanecem fora do corpo rolável.

## Validação

53 testes frontend passaram, incluindo seis casos de concessões independentes, leitura, unidades remotas e URLs antigas. Build TypeScript/Vite aprovado. As 15 opções foram abertas em sessão administrativa temporária, sem gravações de configuração nem envios. Conferidos fechamento de formulário sobre seção, Escape, rolagem e ausência de erros de API.
