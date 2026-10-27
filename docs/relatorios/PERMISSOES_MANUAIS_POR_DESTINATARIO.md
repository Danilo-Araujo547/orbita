# Permissões manuais por destinatário WhatsApp

## Interface

A edição de relatórios manuais está centralizada no detalhe de Destinatários, sem aba Permissões. Links antigos `reportTab=grants` abrem Destinatários.

Ao abrir o detalhe, são carregados apenas os vínculos manuais anteriores daquele destinatário, com nome e código do relatório. Cada vínculo aparece em um cartão compacto. Permissões antigas desativadas também aparecem, identificadas, e permanecem desativadas ao salvar. Ativação exige ação explícita no cartão. Remover um cartão só persiste em Salvar.

Adicionar relatório abre um modal com pesquisa por nome/código. A busca só ocorre após 2 caracteres e retorna resultados paginados. Não é baixado o catálogo completo ao abrir Destinatários ou seu detalhe. Cada resultado tem Adicionar; não duplica relatório já presente. Concluir fecha a pesquisa e mantém as alterações locais até Salvar.

O botão Avançado do destinatário preserva o editor de parâmetros restritivos e permissões automáticas por relatório. O usuário que entra no SCV não foi alterado.

## Persistência e segurança

O banco continua com ReportRecipient e ReportGrant, mantendo um vínculo por relatório internamente. Não há duplicação do destinatário na lista nem exclusão de histórico. Nenhuma migration adicional é necessária para esta funcionalidade; ela utiliza a classificação de relatórios/componentes do catálogo em desenvolvimento no fluxo principal.

- Somente administradores da unidade podem ler/alterar a seleção.
- Apenas relatórios finais da mesma unidade podem ser adicionados. Componentes são recusados no backend.
- Permissões restritivas legadas preservam os parâmetros e não podem ser liberadas sem mapeamento.
- Salvar o destinatário e todos os vínculos ocorre na transação/idempotência existente.
- Token dos vínculos e versão do destinatário detectam edição concorrente; conflito retorna 409 e desfaz toda a alteração.
- Remover solicitação manual não remove envio automático ativo nem seus parâmetros.
- Selecionar manual em vínculo anteriormente inativo mantém o automático efetivamente desativado. Como o estado ativo é compartilhado no modelo, a flag automática deste vínculo é desligada explicitamente e registrada na auditoria. Nenhuma programação é ativada.
- Destinatário recém-criado continua inativo e não verificado. Salvar permissões não verifica nem ativa o número.

## API

GET `/api/v1/report-recipients/{id}/manual-reports/?unit=...` retorna `selected` (IDs ativos), `inactive` (IDs antigos desativados), `reports` (metadados dos cartões já vinculados) e `token`.

GET `/api/v1/report-recipients/manual-report-options/?unit=...&search=...&page=1` pesquisa somente relatórios finais manuais da unidade. Pesquisa vazia ou com menos de 2 caracteres retorna uma página vazia.

POST de criação/configuração do destinatário aceita, além dos campos existentes:

```json
{
  "version": 1,
  "manual_reports": [50, 309, 310],
  "manual_inactive_reports": [],
  "manual_reports_token": "token retornado pela consulta"
}
```

`manual_report_count` é somente leitura. Nos cadastros existentes, o token é obrigatório para alteração da seleção. Clientes antigos que não enviam `manual_reports` continuam preservando os vínculos.

## Validação

Testes em banco isolado `orbita_recipient_manual_checks`, transporte simulado e sem chamadas Oracle/WhatsApp. Verificam múltiplos relatórios, criação do destinatário, preservação automática, restrição legada, isolamento de unidade e rollback por conflito. Build de interface em imagem isolada `orbita-recipient-manual-ui-check`.

A publicação deve ser coordenada com as alterações do catálogo/componentes do fluxo principal. Esta tarefa não reinicia containers nem aplica migrations da aplicação em produção.

## Resultado da validação

- 75 testes aprovados no banco isolado: seleção manual, catálogo de relatórios e WhatsApp.
- TypeScript e build Vite aprovados na imagem de verificação isolada.
- Nenhum container de produção reiniciado por esta alteração. Nenhuma mensagem enviada.
- Logs: /opt/backups/orbita/recipient-manual-tests-isolated.log e /opt/backups/orbita/recipient-manual-frontend-build-final.log.

## Permissões anteriores desativadas

`manual_inactive_reports` preserva explicitamente vínculos manuais antigos desativados. Esses IDs só são aceitos quando correspondem a permissões manuais já desativadas daquele destinatário. Eles não ativam permissões ou programações. Remover o cartão revoga o vínculo manual sem apagar seu histórico ou modificar o estado automático. A auditoria registra vínculos desativados preservados/removidos.
