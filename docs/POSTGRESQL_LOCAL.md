# PostgreSQL local — 13/10/2026

O painel e o Django Admin utilizam PostgreSQL 18.6, banco `orbita`, usuário `orbita`, endereço `127.0.0.1:5432`. A aplicação não usa mais o SQLite. O usuário da aplicação não é superusuário e não pode criar bancos ou usuários.

O cluster fica em `%LOCALAPPDATA%\Orbita\postgresql18\data`. Os binários completos ficam em `artifacts\postgresql\pgsql`, obtidos do pacote oficial da EDB. A instalação preexistente em Program Files estava incompleta e não foi alterada. O servidor escuta apenas em loopback e exige SCRAM-SHA-256.

As configurações ficam no `.env` não versionado, carregado também por `manage.py`. `DATABASE_ENGINE=postgresql` é o padrão; SQLite requer `DATABASE_ENGINE=sqlite` explícito e só serve para cópias históricas/desenvolvimento. Não há retorno automático para SQLite em caso de falha do PostgreSQL.

`Start-Local.ps1` e `Run-Tick.ps1` respeitam o `.env` e iniciam o PostgreSQL quando necessário. `Stop-Local.ps1` para API/painel; o banco continua ativo. Não foi instalado serviço Windows: após reiniciar o computador, execute `Start-Local.ps1` para subir o banco e o app.

O script `Test-Backend.ps1` executa os testes no banco separado `test_orbita`, usando a credencial administrativa local protegida por DPAPI. A aplicação continua usando a conta restrita. Os hashers rápidos de senha existem somente nas fixtures dos testes e não afetam senhas reais.

## Migração e recuperação

`artifacts/postgres-migration-latest.txt` aponta para a pasta de migração. Ela contém o snapshot SQLite anterior, a configuração anterior, exportações, comparação de contagens e SHA-256, backup PostgreSQL em formato custom e evidência da restauração. Esses arquivos são privados e ignorados pelo Git.

194 registros exportados foram preservados integralmente, incluindo hashes de senha, sessões, configurações e os dez agendamentos. Content types e permissões padrão foram recriados pelas migrations e vinculados por chaves naturais. O backup `postgres.dump` foi restaurado em banco isolado e comparado integralmente ao banco migrado.

Para um backup posterior, use `pg_dump -Fc --no-owner --no-acl`, autenticando com a conta da aplicação por variável de ambiente, sem senha na linha de comando. Restaure com `pg_restore --no-owner --no-acl --exit-on-error` em um banco vazio de propriedade da conta da aplicação. Confira os dados antes de trocar a configuração.

Reversão imediata, antes de novas alterações: parar o app, restaurar a configuração `before.env`, definir `DATABASE_ENGINE=sqlite` explicitamente e `SQLITE_PATH` apontando para `before.sqlite3`. Depois de novas alterações no PostgreSQL, essa cópia estará desatualizada: é necessário reconciliar os dados antes de qualquer reversão.

Importações e envios permanecem desabilitados na demonstração. Nenhum servidor legado foi modificado.
