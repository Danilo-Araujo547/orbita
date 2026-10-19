# Appointment reminders

Default lead time: five calendar days for consultations, exams and laboratory appointments. Each unit and appointment type has an editable Rule. Settings > Lembretes > Editar exposes lead days, local send time, weekdays and view refresh interval (default five minutes). Administration > appointment rules also supports editing.

The Oracle date is bound to local today + configured lead days. Repeated polling after the configured hour reuses the current daily ImportRun, captures newly available records and uses stable appointment/message identities. A running import is not started again. Failed refreshes respect the interval. A changed rule version cannot form an obsolete queue.

Rules of 3, 4 and 7 days are retained disabled for history. Old pending notifications are cancelled when the policy changes; already sent, sending or uncertain records are preserved. Configuring rules does not release groups or change transport permissions. Multiple phones remain attached to one appointment.

Deployment validation: PostgreSQL test database, 217 backend tests passed; frontend TypeScript and Vite build passed. Oracle Thick mode is required by the currently configured older Oracle database. The obsolete local simulated SQLite override was removed.

Pending origin selection: AME is configured against 172.16.3.254/hmlvotu, which does not expose the AME views VDIC_CONSULTA_AGENDA_ENVIO_MSG, VDIC_EXAME_AGENDA_ENVIO_MSG and VDIC_LAB_AGENDA_ENVIO_MSG. D5 rules remain disabled until the administrator chooses the intended Oracle/source mapping. No hospital database data were changed.
