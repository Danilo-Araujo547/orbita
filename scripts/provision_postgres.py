import os

import psycopg
from psycopg import sql

with psycopg.connect(
    host="127.0.0.1",
    port=5432,
    dbname="postgres",
    user="orbita_admin",
    password=os.environ["ORBITA_PG_ADMIN_PASSWORD"],
    autocommit=True,
) as connection:
    connection.execute(
        sql.SQL("CREATE ROLE orbita LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {}").format(
            sql.Literal(os.environ["ORBITA_PG_APP_PASSWORD"])
        )
    )
    connection.execute("CREATE DATABASE orbita OWNER orbita ENCODING 'UTF8' TEMPLATE template0")
print("Banco e usuário criados.")
