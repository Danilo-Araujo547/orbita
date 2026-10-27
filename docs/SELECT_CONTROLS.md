# Seletores da interface

Os formulários e filtros usam `frontend/src/components/Select.tsx`; `FilterSelect` reutiliza o mesmo componente. As 93 ocorrências de select nas telas foram migradas em 25/10/2026.

- Lista própria, sem popup nativo do sistema operacional.
- Busca sem acentos quando houver mais de oito opções.
- Setas, Home, End, Enter, Escape e Tab; opções desabilitadas não são selecionadas.
- Cores dos temas claro, escuro e sistema.
- Popup reposicionado conforme espaço disponível, acima de modais e sem corte pelo overflow.
- Um select nativo oculto mantém nome, valor, opções e validação de formulário. As mudanças disparam o evento change consumido pelos handlers existentes.
- Escape no popup não fecha o modal pai.

Novos campos devem usar Select com as mesmas props de um select HTML. Rótulo pode vir de label, aria-label ou aria-labelledby. Evitar usar select nativo diretamente nas telas.

Validação: build TypeScript/Vite, 73 testes existentes, filtro de situação aplicado por clique e teclado, busca por homologacao na conexão, Escape dentro do modal Editar e inspeção dos dois temas. Nenhum registro foi salvo durante a conferência.
