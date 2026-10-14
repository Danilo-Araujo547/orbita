from django.core.management.base import BaseCommand, CommandError
from scheduling.connectors import VIEWS, OracleSource


class Command(BaseCommand):
    help = (
        "Valida conexão, versão e campos das views em transação somente de leitura; não consulta pacientes."
    )

    def handle(self, *args, **options):
        import oracledb

        try:
            with OracleSource().connect() as connection:
                connection.call_timeout = 15000
                self.stdout.write("Versão Oracle: " + connection.version)
                try:
                    with connection.cursor() as cursor:
                        cursor.execute("SET TRANSACTION READ ONLY")
                        for view in VIEWS.values():
                            cursor.execute(
                                f"SELECT CD_AGENDA,DTA_AGENDA,PACIENTE,CELULAR,HORA_MARCADA,CROSS,HORA_CHEGADA,ESPECIALIDADE,TIPO_CONSULTA FROM {view} WHERE 1=0"
                            )
                            self.stdout.write(view + ": campos confirmados")
                        cursor.execute(
                            "SELECT CD_AGENDA,SN_ENVIADO FROM DBASISTEMAS.TBL_LOG_MEGA_MSG WHERE 1=0"
                        )
                        self.stdout.write("Log legado: campos confirmados")
                finally:
                    connection.rollback()
        except oracledb.Error as exc:
            code = getattr(exc.args[0], "full_code", type(exc).__name__)
            raise CommandError("Falha Oracle: " + str(code)) from None
        except ValueError:
            raise CommandError("Oracle não configurado ou credenciais bloqueadas.") from None
