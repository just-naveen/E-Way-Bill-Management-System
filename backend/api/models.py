from django.db import models
from django.utils import timezone
from django.contrib.auth.models import AbstractUser


# Custom User with roles
class User(AbstractUser):
    ROLE_CHOICES = [
        ('admin', 'Admin'),
        ('staff', 'Staff'),
    ]
    role   = models.CharField(max_length=10, choices=ROLE_CHOICES, default='staff')
    mobile = models.CharField(max_length=15, blank=True)
    branch = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return f"{self.username} ({self.role})"


class Company(models.Model):
    name       = models.CharField(max_length=200)
    address    = models.TextField(blank=True)
    mobile     = models.CharField(max_length=15, blank=True)
    gstin      = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Customer(models.Model):
    name         = models.CharField(max_length=200)
    company_name = models.CharField(max_length=200, blank=True)
    mobile       = models.CharField(max_length=15, blank=True)
    email        = models.EmailField(blank=True)
    address      = models.TextField(blank=True)
    city         = models.CharField(max_length=100, blank=True)
    state        = models.CharField(max_length=100, blank=True)
    pincode      = models.CharField(max_length=10,  blank=True)
    gstin        = models.CharField(max_length=20,  blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Transporter(models.Model):
    name       = models.CharField(max_length=200)
    gstin      = models.CharField(max_length=20, blank=True)
    mobile     = models.CharField(max_length=15, blank=True)
    address    = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Vehicle(models.Model):
    vehicle_number = models.CharField(max_length=20, unique=True)
    vehicle_type   = models.CharField(max_length=50, blank=True)
    transporter    = models.ForeignKey(Transporter, on_delete=models.SET_NULL, null=True, blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.vehicle_number


class Consignment(models.Model):
    SERVICE_TYPES = [
        ('standard',  'Standard'),
        ('express',   'Express'),
        ('overnight', 'Overnight'),
    ]
    PAYMENT_MODES = [
        ('credit', 'Credit'),
        ('cash',   'Cash'),
        ('online', 'Online'),
    ]
    DOC_TYPES = [
        ('documents',     'Documents'),
        ('non_documents', 'Non Documents'),
    ]
    DELIVERY_TYPES = [
        ('door_delivery', 'Door Delivery'),
        ('pickup',        'Pickup'),
    ]
    FREIGHT_CHARGE_BY = [
        ('consignor', 'Consignor'),
        ('consignee', 'Consignee'),
    ]

    consignment_no = models.CharField(max_length=50, unique=True)
    booking_date   = models.DateTimeField()
    customer       = models.ForeignKey(Customer, on_delete=models.SET_NULL, null=True, blank=True)
    origin         = models.CharField(max_length=100)
    destination    = models.CharField(max_length=100)
    service_type   = models.CharField(max_length=20, choices=SERVICE_TYPES)
    pincode        = models.CharField(max_length=10, blank=True)
    is_manual_cd   = models.BooleanField(default=True)

    consignor_name    = models.CharField(max_length=200)
    consignor_city    = models.CharField(max_length=100, blank=True)
    consignor_address = models.TextField(blank=True)
    consignor_mobile  = models.CharField(max_length=15, blank=True)
    consignor_pincode = models.CharField(max_length=10, blank=True)
    consignor_state   = models.CharField(max_length=100, blank=True)
    consignor_gstin   = models.CharField(max_length=20,  blank=True)

    consignee_name    = models.CharField(max_length=200)
    consignee_city    = models.CharField(max_length=100, blank=True)
    consignee_address = models.TextField(blank=True)
    consignee_mobile  = models.CharField(max_length=15, blank=True)
    consignee_state   = models.CharField(max_length=100, blank=True)
    consignee_gstin   = models.CharField(max_length=20,  blank=True)

    total_pieces       = models.IntegerField(default=0)
    actual_weight      = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    volumetric_weight  = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    chargeable_weight  = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    invoice_value      = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    invoice_number     = models.CharField(max_length=100, blank=True)
    ewaybill_no        = models.CharField(max_length=50, blank=True)
    product_category   = models.CharField(max_length=100, blank=True)

    payment_mode       = models.CharField(max_length=20, choices=PAYMENT_MODES, default='credit')
    rate_per_kg        = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    freight_amt        = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    fsc_amt            = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    other_charge       = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_amt          = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    cgst               = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sgst               = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    igst               = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    net_total_amt      = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    company            = models.ForeignKey(Company, on_delete=models.SET_NULL, null=True, blank=True)
    invoice_currency   = models.CharField(max_length=10, default='INR')
    delivery_type      = models.CharField(max_length=20, choices=DELIVERY_TYPES, default='door_delivery')
    billing_branch     = models.CharField(max_length=100, blank=True)
    freight_charge_by  = models.CharField(max_length=20, choices=FREIGHT_CHARGE_BY, default='consignor')
    doc_type           = models.CharField(max_length=20, choices=DOC_TYPES, default='non_documents')
    booked_by          = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.consignment_no


class EWayBill(models.Model):
    STATUS_CHOICES = [
        ('active',    'Active'),
        ('cancelled', 'Cancelled'),
        ('expired',   'Expired'),
        ('delivered', 'Delivered'),
    ]

    ewb_number     = models.CharField(max_length=50, unique=True)
    consignment    = models.ForeignKey(Consignment, on_delete=models.SET_NULL, null=True, blank=True)
    generated_date = models.DateTimeField(auto_now_add=True)
    valid_upto     = models.DateTimeField()
    status         = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')

    hsn_code          = models.CharField(max_length=20, blank=True)
    goods_description = models.TextField(blank=True)
    quantity          = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    unit              = models.CharField(max_length=20, blank=True)
    taxable_value     = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cgst_rate         = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    sgst_rate         = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    igst_rate         = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    transporter  = models.ForeignKey(Transporter, on_delete=models.SET_NULL, null=True, blank=True)
    vehicle      = models.ForeignKey(Vehicle,      on_delete=models.SET_NULL, null=True, blank=True)
    distance_km  = models.IntegerField(default=0)

    generated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.ewb_number


# ── NEW: Shipment Timeline Updates ──────────────────────────────────────────
class ShipmentUpdate(models.Model):

    STATUS_CHOICES = [
        ('booked',          '📋 Booked'),
        ('picked_up',       '📦 Picked Up'),
        ('in_transit',      '🚛 In Transit'),
        ('at_hub',          '🏭 At Hub / Sorting Centre'),
        ('out_for_delivery','🛵 Out for Delivery'),
        ('delivered',       '✅ Delivered'),
        ('failed_delivery', '❌ Delivery Failed'),
        ('returned',        '↩️ Returned to Sender'),
        ('cancelled',       '🚫 Cancelled'),
        ('custom',          '📝 Custom Update'),
    ]

    ewb = models.ForeignKey(
        EWayBill,
        on_delete=models.CASCADE,
        related_name='shipment_updates'
    )

    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default='in_transit'
    )

    location = models.CharField(
        max_length=200,
        blank=True
    )

    # ✅ ADD HERE 👇
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    note = models.TextField(blank=True)


    timestamp = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.ewb.ewb_number} — {self.get_status_display()} @ {self.timestamp:%d %b %Y %H:%M}"


class ContactMessage(models.Model):
    STATUS_CHOICES = [
        ('new',     'New'),
        ('read',    'Read'),
        ('replied', 'Replied'),
    ]
    first_name = models.CharField(max_length=100)
    last_name  = models.CharField(max_length=100, blank=True)
    email      = models.EmailField()
    message    = models.TextField()
    status     = models.CharField(max_length=10, choices=STATUS_CHOICES, default='new')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.first_name} {self.last_name} <{self.email}>"


class EmailAlertConfig(models.Model):
    """Singleton — only one row ever exists (id=1)."""
    enabled               = models.BooleanField(default=False)
    recipient_emails      = models.TextField(blank=True, default='')  # comma-separated
    alert_hours_before    = models.IntegerField(default=24)
    send_time             = models.CharField(max_length=5, default='08:00')
    include_ewb_details   = models.BooleanField(default=True)
    include_goods_details = models.BooleanField(default=False)
    notify_on_cancel      = models.BooleanField(default=True)
    last_run              = models.DateTimeField(null=True, blank=True)
    last_run_count        = models.IntegerField(default=0)

    class Meta:
        verbose_name = 'Email Alert Config'

    @property
    def recipient_emails_list(self):
        return [e.strip() for e in self.recipient_emails.split(',') if e.strip()]

    def __str__(self):
        return f'EmailAlertConfig (enabled={self.enabled})'