import logging
import time

from core.models import Unit
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from messaging.inbox import pull_once


class Command(BaseCommand):
    help = "Read signed Meta events over SSH without changing the receiver's queue or forwarding."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        if not settings.META_INBOX_SSH_HOST:
            raise CommandError("META_INBOX_SSH_HOST required.")
        unit = Unit.objects.get(slug=settings.META_UNIT_SLUG)
        try:
            while True:
                close_old_connections()
                try:
                    count = pull_once(unit)
                    if options["once"]:
                        self.stdout.write(f"Eventos associados ao Órbita: {count}")
                except Exception as error:
                    logging.getLogger(__name__).error("meta_inbox_error: %s", type(error).__name__)
                    if options["once"]:
                        raise CommandError("Meta inbox synchronization failed.") from None
                if options["once"]:
                    return
                time.sleep(5)
        except KeyboardInterrupt:
            pass
