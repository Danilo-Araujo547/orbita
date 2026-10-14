from operations.models import Purpose, PurposePolicy, ReportDefinition


def seed_catalog(unit):
    from messaging.models import Template

    for purpose, body, fields in [
        (
            "appointment",
            "Olá, {{1}}. Lembramos {{2}} {{3}}, em {{4}}, chegada às {{5}}. Responda SIM ou NÃO.",
            ["patient", "appointment_type", "procedure", "date", "arrival_time"],
        ),
        (
            "waitlist",
            "Olá, {{1}}. Você deseja continuar aguardando uma vaga? Responda SIM ou NÃO.",
            ["patient"],
        ),
        (
            "summons",
            "Olá, {{1}}. Entre em contato com a unidade sobre a sua convocação. Protocolo: {{2}}.",
            ["patient", "protocol"],
        ),
        (
            "postoperative",
            "Olá, {{1}}. Sobre o procedimento {{2}}, realizado em {{3}}: está tudo bem no local? Responda SIM ou NÃO. Sua resposta será acompanhada pela equipe.",
            ["patient", "surgery", "date"],
        ),
        (
            "movement",
            "Olá, {{1}}. Confira os dados atualizados: {{2}}, em {{3}}, chegada às {{4}}.",
            ["patient", "procedure", "date", "arrival_time"],
        ),
        (
            "absence",
            "Olá, {{1}}. Poderia informar o motivo de ausência em {{2}}, no dia {{3}}?",
            ["patient", "procedure", "date"],
        ),
    ]:
        Template.objects.get_or_create(
            unit=unit,
            name=f"{purpose}_demo",
            language="pt_BR",
            defaults={"purpose": purpose, "body": body, "fields": fields, "approved_for_test": False},
        )
    for purpose in Purpose.values:
        PurposePolicy.objects.get_or_create(
            unit=unit, purpose=purpose, defaults={"response_hours": unit.response_hours}
        )
    Template.objects.get_or_create(
        unit=unit,
        name="cancellation_demo",
        language="pt_BR",
        defaults={
            "purpose": "movement",
            "body": "Olá, {{1}}. Informamos o cancelamento de {{2}}, previsto para {{3}}.",
            "fields": ["patient", "procedure", "date"],
            "approved_for_test": False,
        },
    )
    for code, name, handler in [
        ("confirmed", "Agendamentos confirmados", "confirmed"),
        ("declined", "Agendamentos recusados", "declined"),
        ("not-confirmed", "Agendamentos não confirmados", "not_confirmed"),
        ("not-sent", "Agendamentos com mensagens não enviadas", "not_sent"),
        ("combined", "Agendamentos não enviados / não confirmados", "combined"),
        ("no-response", "Sem resposta no prazo", "no_response"),
        ("failures", "Falhas e bloqueios de comunicação", "failures"),
        ("contacts", "Acompanhamentos e contatos", "contacts"),
    ]:
        ReportDefinition.objects.get_or_create(
            unit=unit,
            code=code,
            defaults={
                "name": name,
                "keyword": code.upper(),
                "handler": handler,
                "enabled": True,
                "parameter_schema": {"start": "date", "end": "date"},
            },
        )
    ReportDefinition.objects.get_or_create(
        unit=unit,
        code="legacy-stock",
        defaults={
            "name": "Estoque — entrada e saída de empréstimos",
            "keyword": "ESTOQUE",
            "source": "oracle",
            "enabled": False,
            "unavailable_reason": "Definição identificada no servidor 172.16.0.124; vínculo com esta unidade, consulta e conta de leitura ainda precisam de homologação.",
        },
    )
