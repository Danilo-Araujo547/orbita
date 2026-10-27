# Importa CROSS: planilha padronizada e parâmetros

## Contrato versão 1

A planilha intermediária possui, nesta ordem: nome_completo, data, hora, celular, celular2, tipo, horario_chegada, data_nascimento, codigo, local, tipo2 e obs.

Os nomes são estáveis. Cada modelo associa suas colunas a esses campos e pode definir template e parâmetros padrão. A importação permite revisar essa configuração antes de gerar a prévia. Cada posição numérica do template aponta para um desses campos; um template com menos variáveis usa somente os campos necessários. A posição no template e a posição da coluna na planilha intermediária não são confundidas.

Datas usam DD/MM/AAAA, horários HH:MM e contatos normalizados com código do país. Identificadores permanecem texto. Campos sem origem ficam vazios. Não são inferidos nascimento pela idade, horário de chegada pelo horário marcado ou data de consulta pela entrada na fila. Contatos além dos dois primeiros permanecem nos metadados e no mesmo registro de acompanhamento.

## Fluxo

1. Configurações → Layouts Importa CROSS → adicionar/editar modelo: formato, template, parâmetros e colunas da origem. Edições criam outra versão.
2. Importa CROSS → Importar planilha: modelo, template, parâmetros, mapeamento e arquivo. Gerar prévia transforma e valida sem criar mensagens.
3. Ver prévia: conferir os 12 campos e baixar CSV padronizado.
4. Confirmar importação: cria os registros e uma comunicação em rascunho, vinculada somente àquela importação e template. Não habilita envios.
5. Programar: informa nome, data e hora do rascunho.
6. Gerar prévia da comunicação: usa exclusivamente a configuração e os valores padronizados daquela importação.

Parâmetro obrigatório vazio impede a confirmação. As finalidades aceitas continuam específicas do formato. Qualificação Pendente não constitui autorização de envio. As proteções existentes para envio real não foram ampliadas.

## Histórico e compatibilidade

O hash da nova prévia considera arquivo e configuração do template/mapeamento. Repetir o mesmo arquivo com a mesma configuração retorna o lote existente. Configuração diferente cria outra prévia, sem reescrever a primeira. Identificadores já existentes com valores conflitantes exigem revisão, sem substituição silenciosa. A configuração guarda versão do contrato, modelo, template, corpo, componentes e parâmetros; mensagens guardam vínculo ao lote e a fotografia utilizada. Alteração posterior da versão do template bloqueia novas mensagens com uma prévia antiga.

APIs existentes permanecem disponíveis. Lotes legados não são reescritos e não recebem template automaticamente. `GET /api/v1/sheet-imports/schema/` expõe o contrato sem dados de pacientes; `GET /api/v1/sheet-imports/{id}/export/` exporta os valores padronizados com as permissões da unidade. `POST /api/v1/campaigns/{id}/schedule/` exige versão e aceita somente rascunhos. A exportação escapa células que possam ser interpretadas como fórmulas.
