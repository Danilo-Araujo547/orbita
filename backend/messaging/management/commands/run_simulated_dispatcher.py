import logging
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from messaging.tasks import dispatch_manual_due


class Command(BaseCommand):
    help = "Process only explicitly released groups in the configured transport."

    def handle(self, *args, **options):
        if settings.SEND_MODE != "simulated" and not (
            settings.SEND_MODE == "meta_test" and settings.META_REAL_ENABLED
        ):
            raise CommandError("Group transport disabled.")
        self.stdout.write(f"Group dispatcher running: {settings.SEND_MODE}.")
        try:
            while True:
                close_old_connections()
                try:
                    dispatch_manual_due()
                except Exception as exc:
                    logging.getLogger(__name__).error("simulated_dispatcher_error: %s", type(exc).__name__)
                time.sleep(1)
        except KeyboardInterrupt:
            pass
