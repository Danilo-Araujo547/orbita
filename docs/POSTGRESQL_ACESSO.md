# Acesso PostgreSQL

Servidor: 172.16.0.59. Porta: 5432. Banco e usuário: orbita.

O serviço db publica 0.0.0.0:5432 para 5432 do contêiner. A senha é a DATABASE_PASSWORD configurada no .env do servidor. Autenticação do PostgreSQL foi mantida; não foi habilitado acesso sem senha.

O volume persistente orbita_postgres_data permanece o mesmo. Aplicação e workers continuam usando o endereço interno db:5432.
