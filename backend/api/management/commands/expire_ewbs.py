"""
Management command: python manage.py expire_ewbs

Bulk-expires all overdue active E-Way Bills.

Schedule this with a cron job or Celery beat task instead of running
the bulk-expire on every read request (which causes unnecessary DB writes
on each GET, degrading performance under high traffic).

Example cron (runs every hour):
  0 * * * * /path/to/venv/bin/python /path/to/manage.py expire_ewbs

Example Celery beat (in settings.py or celery.py):
  CELERY_BEAT_SCHEDULE = {
      'expire-ewbs-hourly': {
          'task': 'api.tasks.expire_overdue_ewbs_task',
          'schedule': crontab(minute=0),  # every hour
      },
  }
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from api.models import EWayBill


class Command(BaseCommand):
    help = 'Bulk-expire all overdue active E-Way Bills'

    def handle(self, *args, **options):
        now     = timezone.now()
        updated = EWayBill.objects.filter(
            status='active',
            valid_upto__lt=now
        ).update(status='expired')

        self.stdout.write(
            self.style.SUCCESS(f'[expire_ewbs] Expired {updated} overdue EWB(s) at {now.isoformat()}')
        )