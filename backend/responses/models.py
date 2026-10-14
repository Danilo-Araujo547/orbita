import uuid

from django.db import models


class Reply(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    event = models.OneToOneField("messaging.ProviderEvent", on_delete=models.PROTECT)
    message = models.ForeignKey(
        "messaging.Message", null=True, blank=True, related_name="replies", on_delete=models.PROTECT
    )
    sender = models.CharField(max_length=40)
    text = models.TextField()
    classification = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)


class Issue(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    message = models.ForeignKey(
        "messaging.Message", null=True, blank=True, related_name="issues", on_delete=models.PROTECT
    )
    reply = models.OneToOneField(Reply, null=True, blank=True, on_delete=models.PROTECT)
    category = models.CharField(max_length=40)
    description = models.TextField()
    resolution = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    case = models.ForeignKey(
        "operations.Case", null=True, blank=True, related_name="corrections", on_delete=models.PROTECT
    )
    contact_phone = models.CharField(max_length=40, blank=True)
