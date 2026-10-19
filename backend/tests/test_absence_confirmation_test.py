import pytest
from operations.models import Case
from operations.services import contextual_classify
from responses.models import Reply
from responses.services import apply_reply, store_event


@pytest.mark.parametrize("text", ["SIM", "NAO", "NÃO"])
@pytest.mark.django_db
def test_confirmation_policy_preserves_original_reply(setup, text):
    message = setup["message"]
    case = message.case
    case.purpose = "absence"
    case.save(update_fields=["purpose"])
    message.purpose = "absence"
    message.state = "delivered"
    message.provider_id = "wamid.absence-test"
    message.template_name = "confirmacao_consulta_sqlite_v1"
    message.snapshot["response_policy"] = "confirmation_test"
    message.save()
    event = store_event(
        message.channel_id,
        "incoming-absence-test",
        "reply",
        str(int(setup["now"].timestamp())),
        {"sender": message.recipient, "text": text, "context_id": message.provider_id},
    )
    apply_reply(event, message.unit)
    reply = Reply.objects.get(event=event)
    assert reply.text == text
    assert reply.classification == "confirmed"
    message.refresh_from_db()
    assert message.response_state == "confirmed"
    assert Case.objects.get(pk=case.pk).outcome == "confirmed"


def test_policy_does_not_change_other_purposes_or_unrecognized_answers():
    assert contextual_classify("NAO", "appointment", response_policy="confirmation_test") == "declined"
    assert contextual_classify("NAO", "absence") == "review"
    assert (
        contextual_classify("NAO CONHECO ESSA PESSOA", "absence", response_policy="confirmation_test")
        == "wrong_person"
    )
    assert contextual_classify("parar", "absence", response_policy="confirmation_test") == "opt_out"
    assert (
        contextual_classify("", "absence", button_id="declined", response_policy="confirmation_test")
        == "confirmed"
    )
