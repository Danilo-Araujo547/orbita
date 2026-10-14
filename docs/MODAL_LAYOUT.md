# Layout dos modais

A revisão foi solicitada ao Gemini pelo `agy`. A execução ampla não concluiu; uma consulta focada retornou a orientação aplicada: modal em flex, cabeçalho e rodapé fora da rolagem, corpo com `min-height: 0`, grids com `min-width: 0` e seletores de checkbox/radio separados dos campos de texto.

`InlineDialog` fornece o portal, limite de altura, foco, Escape, bloqueio durante gravação, restauração da rolagem e rodapé opcional. `FormAction` coloca as ações nesse rodapé e mantém o submit associado ao formulário por `id`/`form`.

Observações, confirmação/recusa, mensagens, programação de grupo, instâncias, Meta e os modais antigos do App usam essa estrutura. A Meta tinha um espaço JSX depois do formulário que impedia `FormAction` de reconhecer o elemento; removido. O botão de salvar agora fica no rodapé.

## Conferência

- Regra pós-cirúrgica em 1024×768, 1366×768 e 1920×1080: modal dentro da viewport, rodapé visível, sem transbordo horizontal; checkbox com 16px.
- Unidade, Oracle, Meta, conexão remota, observações, confirmação/recusa, mensagens e programação de grupo em 1024×768: rodapé visível e sem transbordo horizontal.
- Submits da unidade, Oracle, Meta, conexão, observação, resposta e grupo associados aos respectivos formulários.
- Verde da confirmação preservado; seletores de recusa permanecem separados do estilo dos botões primários.
- Escape fecha e restaura a rolagem; navegação por Tab permanece no modal.
- Modal de teste conferido também no tema claro em 1366×768.
- Build TypeScript/Vite e 31 testes do frontend aprovados.

Nenhum cadastro ou envio foi realizado na conferência visual. Os testes de layout abriram e fecharam os formulários sem submetê-los.
