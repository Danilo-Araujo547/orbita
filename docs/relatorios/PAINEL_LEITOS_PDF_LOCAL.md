# Painel Leitos: PDF publicado manualmente no SCV

Implementado em 24/10/2026 para `scv / legacy123-309` (ID 308).

## Publicar o arquivo

- Pasta no servidor: `/opt/orbita/files/reports/painel-leitos/`.
- Nome fixo: `painel-leitos.pdf`.
- Arquivo PDF regular, completo, sem senha, com 1 a 200 páginas e até 7 MiB (7.340.032 bytes).
- Inserir manualmente o documento aprovado nessa pasta. Para substituir, copiar primeiro como `painel-leitos.pdf.upload` na mesma pasta e renomear para `painel-leitos.pdf` ao concluir. A troca por renomeação evita leitura durante a transferência.
- Manter arquivo legível pelo grupo 1000 dos containers (por exemplo, `root:1000` e modo `0640`); pasta `root:1000`, modo `2750`, restrita à operação e ao backend. O volume existente monta `/opt/orbita/files` como `/app/files:ro` no api/worker/scheduler. Não publicar como arquivo estático do painel.
- O arquivo não deve ser adicionado ao Git. Não copiar PDFs de pacientes para evidências ou logs.

## Solicitação e envio

O cadastro usa `source=external_file`, `handler=external_pdf_v1`, sem conexão hospitalar, SQL ou parâmetros de data. A fonte é um caminho fixo autorizado por unidade/código; nenhum caminho recebido na API ou WhatsApp é aceito.

Com arquivo válido, a geração pelo painel e a solicitação WhatsApp seguem os controles normais de unidade, revisão, versão, destinatário e permissão. O sistema entrega o PDF original, sem recalcular leitos ou modificar o layout. O conteúdo e a atualidade clínica são responsabilidade de quem publica o arquivo; a data de modificação não comprova atualidade dos dados.

Arquivo ausente ou inválido deixa o relatório indisponível para novas solicitações. O painel administrativo mostra a pendência. Não enviar documento de teste nessa pasta.

As permissões existentes são preservadas. Na conferência inicial havia 19 vínculos e nenhum manual ativo. Autorizar os destinatários desejados em **Destinatários**, sem ativar identidades antigas indiscriminadamente. Nenhuma programação ou controle automático foi habilitado por esta integração.

## Fotografia e substituição

A solicitação captura SHA-256, tamanho, número de páginas e modificação do arquivo. Se o PDF mudar antes da geração, a execução é bloqueada: solicitar novamente. Cada execução pronta guarda sua cópia original no resultado protegido. Substituir ou remover o arquivo de entrada preserva downloads antigos, sempre sujeitos à revalidação de acesso/versões. O hash da cópia é verificado antes do download ou envio.

`row_count=1` representa um documento de entrada, sem afirmar quantidade de leitos, pacientes ou linhas de consulta.

## Implementação e instalação

- `backend/operations/external_pdf.py`: leitura limitada, validação, fotografia e geração.
- `backend/operations/reporting.py`: integração ao executor existente.
- `backend/tests/test_external_pdf.py`: testes com PDFs fictícios em memória/pasta temporária e transporte simulado.
- `python manage.py configure_local_bed_panel --expected-version <versao-atual>`: migração explícita com transação, controle de versão e auditoria. Recusa programações habilitadas e preserva grants. Não executar periodicamente; cada uso altera a versão do cadastro.

Estado de aceite: integração testada com arquivo fictício. Aguardando publicação manual do PDF real e aceite no aparelho autorizado. Nenhum disparo real integra os testes.

Validação automatizada: **121 testes aprovados** (PDF local, catálogo, WhatsApp, médicos e permissões manuais). Django check sem problemas; nenhuma migration nova detectada. O check de histórico no comando makemigrations não consultou a base orbita_suite porque ela não existe fora da execução pytest; as migrations foram aplicadas na base isolada durante os testes. Build api/worker/scheduler concluído.


Atualização em 24/10/2026, 11:08 BRT: por solicitação do usuário, copiado o PDF existente mais recente (criação do documento: 23/10/2026, 01:01:21 BRT), de `comparacao_2026-10-23/Painel_Leitos__PAINEL_LEITOS.pdf` nas evidências para `/opt/orbita/files/reports/painel-leitos/painel-leitos.pdf`. Validado pelo leitor real do backend: 1 página, 226.260 bytes, nenhuma pendência de prontidão. A data do documento não comprova atualidade dos dados. Nenhuma mensagem enviada ou permissão alterada; autorização dos destinatários e aceite no aparelho continuam pendentes. Evidência: `/opt/backups/orbita/painel-leitos-local-20261024-135835/pdf-publication.json`.
