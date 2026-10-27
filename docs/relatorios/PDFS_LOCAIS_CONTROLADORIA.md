# PDFs locais da Controladoria

Configurado em 24/10/2026 para a unidade SCV, por solicitação do usuário. Os relatórios abaixo obtêm um PDF já produzido e publicado manualmente no servidor novo.

| Código | Relatório | Arquivo no host |
|---|---|---|
| legacy123-162 | Indicadores Gerenciais | `/opt/orbita/files/reports/indicadores-gerenciais/indicadores-gerenciais.pdf` |
| legacy123-163 | Indicadores Estratégicos | `/opt/orbita/files/reports/indicadores-estrategicos/indicadores-estrategicos.pdf` |
| legacy123-309 | Painel Leitos | `/opt/orbita/files/reports/painel-leitos/painel-leitos.pdf` |

## Publicação

Manter os nomes exatos. Para substituir, copiar com sufixo `.upload` na mesma pasta e renomear ao terminar a transferência. Pastas `root:1000`, modo `2750`; PDF legível pelo backend (por exemplo `root:1000`, `0640`). O backend recebe o volume como `/app/files:ro`. Os PDFs operacionais dessas pastas são ignorados pelo Git e não são publicados como arquivos estáticos.

Limites: PDF completo, sem senha, de 1 a 200 páginas e até 7 MiB. Ausência ou arquivo inválido bloqueia novas solicitações. Caminhos são fixados por unidade/código no backend; nenhum caminho de requisição é aceito.

O fluxo não recalcula indicadores nem consulta Oracle, Firebird, Tableau ou o servidor legado. O PDF é entregue sem modificar seus bytes ou layout. Não há pergunta de data: usa-se o arquivo publicado. A operação atualiza manualmente seu conteúdo; modificação/criação do arquivo não garante atualidade clínica dos dados.

Cada solicitação registra tamanho, SHA-256, páginas e modificação. Substituição antes da geração bloqueia a execução antiga; solicitar novamente. Execuções prontas preservam cópia protegida, sujeita à revalidação de definição, permissões e destinatário antes de download/envio.

## Cadastros e permissões

Fonte `external_file`, handler `external_pdf_v1`, sem conexão, SQL, componentes ou parâmetros. O comando `python manage.py configure_local_pdf --code legacy123-162 --expected-version <versao-atual>` configura um dos códigos permitidos, com transação e auditoria. O comando anterior `configure_local_bed_panel` permanece compatível. Não executar periodicamente: cada configuração altera a versão.

Permissões existentes são preservadas. Autorizar individualmente os destinatários na interface. A configuração recusa programações habilitadas; não habilita entrega automática ou verifica números. Não ampliar a autorização do Painel Leitos para os outros PDFs implicitamente.

## PDFs iniciais

Copiados das evidências existentes, sem acessar ou alterar servidores legados:

- Gerenciais: `Gerencial__INDICADORES_GERENCIAIS.pdf`, 8 páginas, 775.209 bytes, documento criado em 19/10/2026.
- Estratégicos: `Estratégicos__INDICADORES_ESTRATEGICOS.pdf`, 2 páginas, 136.409 bytes, documento criado em 22/10/2026.

A cópia inicial não representa uma coleta de dados atuais. O gerador original continua fora do escopo. Backup e hashes: `/opt/backups/orbita/gerenciais-estrategicos-local-20261024-162801/`.

150 testes isolados aprovados (PDFs locais, catálogo, WhatsApp e permissões manuais), com transporte simulado.

Publicação concluída: IDs 168/169, versão 2; geração pronta e download autenticado 200 dos PDFs originais. Django check e migrate --check passaram. Nenhuma mensagem enviada ou permissão alterada. Autorizar destinatários e conferir no aparelho.
