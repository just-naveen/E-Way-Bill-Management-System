# api/management/commands/send_ewb_alerts.py
#
# Usage:
#   python manage.py send_ewb_alerts
#
# Set up a cron job to run this daily at your chosen time, e.g.:
#   0 8 * * * cd /path/to/project && python manage.py send_ewb_alerts

from django.core.management.base import BaseCommand
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone
from datetime import timedelta

from api.models import EWayBill          # adjust if your model is named differently


class Command(BaseCommand):
    help = 'Send expiry warning emails for E-Way Bills expiring within the configured window'

    def handle(self, *args, **kwargs):
        # ── Load config from DB or fall back to defaults ──────────────
        try:
            from api.models import EmailAlertConfig
            cfg = EmailAlertConfig.objects.first()
            if not cfg or not cfg.enabled:
                self.stdout.write('Email alerts disabled — skipping.')
                return
            hours_before    = cfg.alert_hours_before
            recipients      = cfg.recipient_emails_list   # property returning list
            include_goods   = cfg.include_goods_details
            include_ewb     = cfg.include_ewb_details
            notify_cancel   = cfg.notify_on_cancel
        except Exception:
            # fallback defaults if model not yet created
            hours_before  = 24
            recipients    = getattr(settings, 'EWB_ALERT_EMAILS', [])
            include_goods = False
            include_ewb   = True
            notify_cancel = True

        if not recipients:
            self.stdout.write('No recipients configured — skipping.')
            return

        now        = timezone.now()
        deadline   = now + timedelta(hours=hours_before)

        # ── Find expiring EWBs ─────────────────────────────────────────
        expiring = EWayBill.objects.filter(
            status='active',
            valid_upto__gte=now,
            valid_upto__lte=deadline,
        ).select_related('consignment', 'transporter', 'vehicle')

        cancelled = EWayBill.objects.filter(
            status='cancelled',
            updated_at__gte=now - timedelta(hours=24),
        ) if notify_cancel else EWayBill.objects.none()

        if not expiring.exists() and not cancelled.exists():
            self.stdout.write('No expiring or cancelled EWBs found — no emails sent.')
            return

        # ── Build email body ──────────────────────────────────────────
        lines = []
        lines.append('WayBillPro — E-Way Bill Alert')
        lines.append('=' * 50)
        lines.append('')

        if expiring.exists():
            lines.append(f'⚠️  {expiring.count()} E-Way Bill(s) expiring within {hours_before} hours:')
            lines.append('')
            for ewb in expiring:
                lines.append(f'  EWB Number  : {ewb.ewb_number}')
                if include_ewb:
                    lines.append(f'  Valid Until : {ewb.valid_upto.strftime("%d %b %Y, %I:%M %p")}')
                    if ewb.consignment:
                        lines.append(f'  Consignment : {ewb.consignment.consignment_no}')
                        lines.append(f'  Route       : {ewb.consignment.origin} → {ewb.consignment.destination}')
                if include_goods:
                    lines.append(f'  HSN Code    : {ewb.hsn_code or "—"}')
                    lines.append(f'  Goods       : {ewb.goods_description or "—"}')
                    lines.append(f'  Value       : ₹{ewb.taxable_value or 0:,.2f}')
                lines.append('')

        if cancelled.exists():
            lines.append(f'🚫  {cancelled.count()} E-Way Bill(s) cancelled in the last 24 hours:')
            lines.append('')
            for ewb in cancelled:
                lines.append(f'  EWB Number  : {ewb.ewb_number}')
                lines.append(f'  Cancelled at: {ewb.updated_at.strftime("%d %b %Y, %I:%M %p")}')
                lines.append('')

        lines.append('─' * 50)
        lines.append('Please log in to WayBillPro to renew or take action.')
        lines.append('')
        lines.append('This is an automated message. Do not reply.')

        body = '\n'.join(lines)

        # ── Send ──────────────────────────────────────────────────────
        subject = f'⚠️ EWB Expiry Alert — {expiring.count()} bill(s) expiring in {hours_before}h'

        try:
            send_mail(
                subject=subject,
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=recipients,
                fail_silently=False,
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f'✅ Alert email sent to {len(recipients)} recipient(s). '
                    f'Expiring: {expiring.count()}, Cancelled: {cancelled.count()}'
                )
            )

            # ── Update last_run in config ──────────────────────────────
            try:
                cfg.last_run       = now
                cfg.last_run_count = expiring.count() + cancelled.count()
                cfg.save(update_fields=['last_run', 'last_run_count'])
            except Exception:
                pass

        except Exception as e:
            self.stderr.write(self.style.ERROR(f'❌ Failed to send email: {e}'))