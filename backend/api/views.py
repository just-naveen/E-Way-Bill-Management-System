from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate
from django.db.models import Count, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime as _parse_dt
from datetime import timedelta, datetime
import pytz
import csv
import io
from .models import (
    User, Company, Customer, Transporter, Vehicle,
    Consignment, EWayBill, ContactMessage, ShipmentUpdate, EmailAlertConfig
)
from django.core.mail import send_mail
from django.conf import settings as django_settings
from .serializers import (
    UserSerializer, CompanySerializer, CustomerSerializer,
    TransporterSerializer, VehicleSerializer, ConsignmentSerializer,
    EWayBillSerializer
)

# ─── TIMEZONE HELPER ────────────────────────────────────────────────────────
# FIX: MySQL on Windows does not have timezone tables loaded, so Django's
# __date lookup uses CONVERT_TZ(..., 'UTC', 'Asia/Kolkata') which returns
# NULL for every row — causing all date filters to return 0 results.
#
# Solution: Convert the date string to an IST-aware datetime range ourselves,
# then filter using __gte / __lte on the full datetime.

IST = pytz.timezone('Asia/Kolkata')


def parse_date_range(date_from_str, date_to_str):
    """
    Convert 'YYYY-MM-DD' strings to IST-aware datetime objects.
    date_from → start of that day in IST (00:00:00)
    date_to   → end of that day in IST (23:59:59)
    """
    dt_from = None
    dt_to   = None

    if date_from_str:
        try:
            d = datetime.strptime(date_from_str, '%Y-%m-%d')
            dt_from = IST.localize(datetime(d.year, d.month, d.day, 0, 0, 0))
        except ValueError:
            pass

    if date_to_str:
        try:
            d = datetime.strptime(date_to_str, '%Y-%m-%d')
            dt_to = IST.localize(datetime(d.year, d.month, d.day, 23, 59, 59))
        except ValueError:
            pass

    return dt_from, dt_to


# ─── EWB VALIDITY HELPER ────────────────────────────────────────────────────
# FIX: Correct boundary handling per GST Notification 12/2018.
# Strict inequalities (<) used so boundary values fall into higher band.
#   < 100 km  → 1 day
#   < 300 km  → 3 days
#   < 500 km  → 5 days
#   < 1000 km → 10 days
#   >= 1000   → 15 days

def ewb_validity_days(distance_km: int) -> int:
    d = int(distance_km or 0)
    if d < 100:   return 1
    if d < 300:   return 3
    if d < 500:   return 5
    if d < 1000:  return 10
    return 15


# ─── LAZY-EXPIRE HELPER ─────────────────────────────────────────────────────
# Use this for single-EWB lazy expiry only (not bulk on every list call).

def lazy_expire_single(ewb):
    """Expire a single EWB in-place if its valid_upto has passed."""
    if ewb.status == 'active' and ewb.valid_upto and ewb.valid_upto < timezone.now():
        ewb.status = 'expired'
        ewb.save(update_fields=['status'])
    return ewb


# ─── AUTH ───────────────────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    email    = request.data.get('email', '').strip()
    password = request.data.get('password', '').strip()

    if not email or not password:
        return Response(
            {'error': 'Email and password are required.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        user_obj = User.objects.get(email=email)
        user = authenticate(username=user_obj.username, password=password)
    except User.DoesNotExist:
        user = None

    if not user:
        return Response(
            {'error': 'Invalid credentials'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    if not user.is_active:
        return Response(
            {'error': 'Account is inactive. Contact administrator.'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    refresh = RefreshToken.for_user(user)
    return Response({
        'access':  str(refresh.access_token),
        'refresh': str(refresh),
        'user': {
            'id':       user.id,
            'username': user.username,
            'email':    user.email,
            'role':     user.role,
            'branch':   user.branch if hasattr(user, 'branch') else '',
        }
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout(request):
    try:
        refresh_token = request.data.get('refresh')
        if refresh_token:
            token = RefreshToken(refresh_token)
            token.blacklist()
    except Exception:
        pass
    return Response({'message': 'Logged out successfully'})


# ─── DASHBOARD ──────────────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    today      = timezone.now().date()
    this_month = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_consignments = Consignment.objects.count()
    active_ewaybills   = EWayBill.objects.filter(status='active').count()
    expired_ewaybills  = EWayBill.objects.filter(status='expired').count()
    total_customers    = Customer.objects.count()
    total_vehicles     = Vehicle.objects.count()

    expiring_soon = EWayBill.objects.filter(
        status='active',
        valid_upto__lte=timezone.now() + timedelta(hours=24)
    ).count()

    monthly_revenue = Consignment.objects.filter(
        created_at__gte=this_month
    ).aggregate(total=Sum('net_total_amt'))['total'] or 0

    return Response({
        'total_consignments': total_consignments,
        'today_bookings':     Consignment.objects.filter(created_at__date=today).count(),
        'active_ewaybills':   active_ewaybills,
        'expired_ewaybills':  expired_ewaybills,
        'expiring_soon':      expiring_soon,
        'total_customers':    total_customers,
        'total_vehicles':     total_vehicles,
        'monthly_revenue':    float(monthly_revenue),
    })


# ─── USERS ──────────────────────────────────────────────────────────────────
class UserViewSet(viewsets.ModelViewSet):
    queryset           = User.objects.all()
    serializer_class   = UserSerializer
    permission_classes = [IsAuthenticated]


# ─── COMPANY ────────────────────────────────────────────────────────────────
class CompanyViewSet(viewsets.ModelViewSet):
    queryset           = Company.objects.all()
    serializer_class   = CompanySerializer
    permission_classes = [IsAuthenticated]


# ─── CUSTOMER ───────────────────────────────────────────────────────────────
class CustomerViewSet(viewsets.ModelViewSet):
    queryset           = Customer.objects.all()
    serializer_class   = CustomerSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Customer.objects.all().order_by('name')
        search   = self.request.query_params.get('search', None)
        if search:
            queryset = queryset.filter(name__icontains=search)
        return queryset


# ─── TRANSPORTER ────────────────────────────────────────────────────────────
class TransporterViewSet(viewsets.ModelViewSet):
    queryset           = Transporter.objects.all().order_by('name')
    serializer_class   = TransporterSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Transporter.objects.all().order_by('name')
        search   = self.request.query_params.get('search', None)
        if search:
            queryset = queryset.filter(name__icontains=search)
        return queryset


# ─── VEHICLE ────────────────────────────────────────────────────────────────
class VehicleViewSet(viewsets.ModelViewSet):
    queryset           = Vehicle.objects.all().order_by('vehicle_number')
    serializer_class   = VehicleSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Vehicle.objects.all().order_by('vehicle_number')
        search   = self.request.query_params.get('search', None)
        if search:
            queryset = queryset.filter(vehicle_number__icontains=search)
        return queryset


# ─── CONSIGNMENT ────────────────────────────────────────────────────────────
class ConsignmentViewSet(viewsets.ModelViewSet):
    queryset           = Consignment.objects.all().order_by('-created_at')
    serializer_class   = ConsignmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset  = Consignment.objects.all().order_by('-created_at')
        search    = self.request.query_params.get('search', None)
        date_from = self.request.query_params.get('date_from', None)
        date_to   = self.request.query_params.get('date_to', None)

        if search:
            queryset = queryset.filter(consignment_no__icontains=search)

        # FIX: Use datetime range instead of __date to avoid CONVERT_TZ issue
        dt_from, dt_to = parse_date_range(date_from, date_to)
        if dt_from:
            queryset = queryset.filter(booking_date__gte=dt_from)
        if dt_to:
            queryset = queryset.filter(booking_date__lte=dt_to)

        return queryset

    def perform_create(self, serializer):
        serializer.save(booked_by=self.request.user)


# ─── EWAYBILL ───────────────────────────────────────────────────────────────
class EWayBillViewSet(viewsets.ModelViewSet):
    queryset           = EWayBill.objects.all().order_by('-created_at')
    serializer_class   = EWayBillSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset      = EWayBill.objects.all().order_by('-created_at')
        status_filter = self.request.query_params.get('status', None)
        search        = self.request.query_params.get('search', None)

        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if search:
            queryset = queryset.filter(ewb_number__icontains=search)
        return queryset

    def perform_create(self, serializer):
        ewb = serializer.save(generated_by=self.request.user)

        # AUTO CREATE FIRST TRACKING ENTRY on every new EWB
        try:
            location = ''
            if ewb.consignment and ewb.consignment.origin:
                location = ewb.consignment.origin
            elif ewb.consignment and ewb.consignment.consignor_city:
                location = ewb.consignment.consignor_city

            # FIX: Guard against duplicate tracking entries
            if not ShipmentUpdate.objects.filter(ewb=ewb, status='booked').exists():
                ShipmentUpdate.objects.create(
                    ewb=ewb,
                    status='booked',
                    location=location,
                    note=f'E-Way Bill {ewb.ewb_number} created successfully.'
                )
        except Exception as e:
            print(f"Auto tracking failed for EWB {ewb.ewb_number}: {str(e)}")


# ─── EXPIRING EWBs (navbar bell) ────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def expiring_ewaybills(request):
    """
    Returns e-way bills expiring within the next 24 hours.
    FIX: Removed bulk auto-expire from this endpoint to avoid write-on-every-read.
    Auto-expiry is now only done via management command or the dedicated
    expire_overdue_ewbs endpoint (admin only). Lazy expiry still applies
    per-EWB when viewed individually.
    """
    now  = timezone.now()
    in24 = now + timedelta(hours=24)

    expiring = (
        EWayBill.objects
        .select_related('consignment')
        .filter(status='active', valid_upto__gte=now, valid_upto__lte=in24)
        .order_by('valid_upto')
    )

    data = [
        {
            'id':             ewb.pk,
            'ewb_number':     ewb.ewb_number,
            'valid_upto':     ewb.valid_upto,
            'consignment_no': ewb.consignment.consignment_no if ewb.consignment else None,
            'origin':         ewb.consignment.origin         if ewb.consignment else None,
            'destination':    ewb.consignment.destination    if ewb.consignment else None,
        }
        for ewb in expiring
    ]

    return Response({'count': len(data), 'results': data})


# ─── ADMIN: TRIGGER BULK EXPIRE ─────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def expire_overdue_ewbs(request):
    """
    POST /api/ewaybills/expire-overdue/
    Admin/staff only. Bulk-expires all overdue active EWBs.
    Called by a scheduled task or manually from the admin panel.
    """
    if request.user.role not in ('admin', 'staff'):
        return Response({'error': 'Admin or staff access required.'}, status=status.HTTP_403_FORBIDDEN)

    now = timezone.now()
    updated = EWayBill.objects.filter(status='active', valid_upto__lt=now).update(status='expired')
    return Response({'expired': updated})


# ─── BULK EWB UPLOAD helpers ─────────────────────────────────────────────────
BULK_REQUIRED_COLUMNS = {'ewb_number', 'valid_upto'}
BULK_VALID_STATUSES   = {'active', 'cancelled', 'expired', 'delivered'}

# FIX: EWB numbers must be exactly 12 digits
EWB_NUMBER_LENGTH = 12


def _validate_ewb_number(ewb_number: str) -> bool:
    """EWB number must be exactly 12 digits (GST law requirement)."""
    return ewb_number.isdigit() and len(ewb_number) == EWB_NUMBER_LENGTH


def _parse_valid_upto(raw: str):
    raw = raw.strip()
    dt  = _parse_dt(raw)
    if dt:
        return timezone.make_aware(dt) if timezone.is_naive(dt) else dt
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            d  = datetime.strptime(raw, fmt)
            return timezone.make_aware(d.replace(hour=23, minute=59, second=59))
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: '{raw}'")


def _to_decimal(raw: str, field: str):
    raw = raw.strip()
    if raw == '':
        return 0
    try:
        return float(raw)
    except ValueError:
        raise ValueError(f"'{field}' must be a number, got '{raw}'")


# ─── BULK EWB UPLOAD ─────────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def bulk_upload_ewaybills(request):
    """
    POST /api/ewaybills/bulk-upload/
    Accepts multipart/form-data with field 'file' (CSV, max 5 MB).
    Returns { created, skipped, errors, total_rows }
    """
    if request.user.role not in ('admin', 'staff'):
        return Response(
            {'error': 'Only admin or staff can perform bulk uploads.'},
            status=status.HTTP_403_FORBIDDEN
        )

    file = request.FILES.get('file')
    if not file:
        return Response(
            {'error': 'No file provided. Send a CSV as multipart field "file".'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if not file.name.lower().endswith('.csv'):
        return Response(
            {'error': 'Only .csv files are accepted.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if file.size > 5 * 1024 * 1024:
        return Response(
            {'error': 'File too large. Maximum size is 5 MB.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        text = file.read().decode('utf-8-sig')
    except UnicodeDecodeError:
        return Response(
            {'error': 'File encoding not supported. Please save as UTF-8 CSV.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    reader     = csv.DictReader(io.StringIO(text))
    fieldnames = [f.strip().lower() for f in (reader.fieldnames or [])]
    missing    = BULK_REQUIRED_COLUMNS - set(fieldnames)
    if missing:
        return Response(
            {'error': f'CSV is missing required columns: {", ".join(sorted(missing))}'},
            status=status.HTTP_400_BAD_REQUEST
        )

    created_list = []
    skipped      = 0
    errors       = []

    for line_no, raw_row in enumerate(reader, start=2):
        row        = {k.strip().lower(): (v or '').strip() for k, v in raw_row.items()}
        ewb_number = row.get('ewb_number', '').strip()

        if not ewb_number:
            errors.append({'row': line_no, 'ewb_number': '', 'reason': 'ewb_number is empty'})
            continue

        # FIX: Validate 12-digit EWB number
        if not _validate_ewb_number(ewb_number):
            errors.append({
                'row': line_no,
                'ewb_number': ewb_number,
                'reason': f'EWB number must be exactly {EWB_NUMBER_LENGTH} digits (got {len(ewb_number)})'
            })
            continue

        if EWayBill.objects.filter(ewb_number=ewb_number).exists():
            skipped += 1
            continue

        try:
            valid_upto = _parse_valid_upto(row.get('valid_upto', ''))
        except ValueError as exc:
            errors.append({'row': line_no, 'ewb_number': ewb_number, 'reason': str(exc)})
            continue

        consignment = None
        cns_no = row.get('consignment_no', '').strip()
        if cns_no:
            try:
                consignment = Consignment.objects.get(consignment_no=cns_no)
            except Consignment.DoesNotExist:
                errors.append({'row': line_no, 'ewb_number': ewb_number,
                                'reason': f"Consignment '{cns_no}' not found"})
                continue

        numeric_error = None
        numeric_vals  = {}
        for field in ('quantity', 'taxable_value', 'cgst_rate', 'sgst_rate', 'igst_rate'):
            try:
                numeric_vals[field] = _to_decimal(row.get(field, ''), field)
            except ValueError as exc:
                numeric_error = str(exc)
                break
        if numeric_error:
            errors.append({'row': line_no, 'ewb_number': ewb_number, 'reason': numeric_error})
            continue

        # FIX: Validate CGST+SGST vs IGST mutual exclusion
        cgst = numeric_vals.get('cgst_rate', 0)
        sgst = numeric_vals.get('sgst_rate', 0)
        igst = numeric_vals.get('igst_rate', 0)
        if (cgst > 0 or sgst > 0) and igst > 0:
            errors.append({
                'row': line_no, 'ewb_number': ewb_number,
                'reason': 'Cannot use CGST/SGST together with IGST. Use CGST+SGST for same state, IGST for inter-state.'
            })
            continue

        # FIX: Warn if taxable value < 50000 (logged but not blocked — exemptions exist)
        taxable_value = numeric_vals.get('taxable_value', 0)

        try:
            numeric_vals['distance_km'] = int(row.get('distance_km', '0').strip() or 0)
        except ValueError:
            errors.append({'row': line_no, 'ewb_number': ewb_number,
                           'reason': "'distance_km' must be a whole number"})
            continue

        raw_status = row.get('status', 'active').lower().strip() or 'active'
        if raw_status not in BULK_VALID_STATUSES:
            errors.append({'row': line_no, 'ewb_number': ewb_number,
                           'reason': f"Invalid status '{raw_status}'. Use: {', '.join(sorted(BULK_VALID_STATUSES))}"})
            continue

        created_list.append(EWayBill(
            ewb_number        = ewb_number,
            consignment       = consignment,
            valid_upto        = valid_upto,
            status            = raw_status,
            hsn_code          = row.get('hsn_code', ''),
            goods_description = row.get('goods_description', ''),
            quantity          = numeric_vals['quantity'],
            unit              = row.get('unit', ''),
            taxable_value     = taxable_value,
            cgst_rate         = cgst,
            sgst_rate         = sgst,
            igst_rate         = igst,
            distance_km       = numeric_vals['distance_km'],
            generated_by      = request.user,
        ))

    # FIX: MySQL bulk_create returns no IDs — save individually
    saved_count = 0
    for ewb_obj in created_list:
        try:
            ewb_obj.save()
            saved_count += 1
            loc = ''
            if ewb_obj.consignment:
                loc = ewb_obj.consignment.origin or ewb_obj.consignment.consignor_city or ''
            if not ShipmentUpdate.objects.filter(ewb=ewb_obj, status='booked').exists():
                ShipmentUpdate.objects.create(ewb=ewb_obj, status='booked', location=loc,
                    note=f'E-Way Bill {ewb_obj.ewb_number} imported via bulk upload.')
        except Exception:
            skipped += 1

    return Response({
        'created':    saved_count,
        'skipped':    skipped,
        'errors':     errors,
        'total_rows': saved_count + skipped + len(errors),
    }, status=status.HTTP_200_OK)


# ─── BULK UPLOAD CSV TEMPLATE ────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def bulk_upload_template(request):
    """GET /api/ewaybills/bulk-upload/template/ — download a ready-to-fill CSV"""
    from django.http import HttpResponse as DjangoHttpResponse
    header = ['ewb_number', 'valid_upto', 'consignment_no', 'hsn_code', 'goods_description',
              'quantity', 'unit', 'taxable_value', 'cgst_rate', 'sgst_rate', 'igst_rate',
              'distance_km', 'status']
    # FIX: ewb_number is 12 digits
    sample = ['123456789012', '2025-12-31 23:59', 'CNS-001', '8471', 'Laptop computers',
              '10', 'NOS', '50000', '9', '9', '0', '250', 'active']
    out    = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerow(sample)
    resp = DjangoHttpResponse(out.getvalue(), content_type='text/csv')
    resp['Content-Disposition'] = 'attachment; filename="ewb_bulk_upload_template.csv"'
    return resp


# ─── PUBLIC EWB TRACKING — query param style ────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def track_ewb(request):
    ewb_number = (
        request.query_params.get('ewb_number', '').strip() or
        request.query_params.get('ewb', '').strip()
    )

    if not ewb_number:
        return Response(
            {'error': 'Provide EWB number as ?ewb_number=XXXXXXXXXXXX'},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        ewb = EWayBill.objects.select_related(
            'consignment', 'transporter', 'vehicle', 'generated_by'
        ).get(ewb_number__iexact=ewb_number)
    except EWayBill.DoesNotExist:
        return Response(
            {'error': 'EWB not found.'},
            status=status.HTTP_404_NOT_FOUND
        )

    # FIX: Lazy-expire this single EWB before responding
    ewb = lazy_expire_single(ewb)

    updates  = ewb.shipment_updates.all().order_by('-timestamp')
    timeline = [
        {
            "status":       u.status,
            "status_label": u.get_status_display(),
            "location":     u.location,
            "note":         u.note,
            "timestamp":    u.timestamp,
            "latitude":     u.latitude,
            "longitude":    u.longitude,
        }
        for u in updates
    ]

    # Include transporter & vehicle details for public tracking
    return Response({
        'ewb_number':        ewb.ewb_number,
        'status':            ewb.status,
        'valid_upto':        ewb.valid_upto,
        'distance_km':       ewb.distance_km,
        'origin':            ewb.consignment.origin         if ewb.consignment else None,
        'destination':       ewb.consignment.destination    if ewb.consignment else None,
        'consignment_no':    ewb.consignment.consignment_no if ewb.consignment else None,
        # Goods details
        'hsn_code':          ewb.hsn_code,
        'goods_description': ewb.goods_description,
        'quantity':          float(ewb.quantity),
        'unit':              ewb.unit,
        'taxable_value':     float(ewb.taxable_value),
        'cgst_rate':         float(ewb.cgst_rate),
        'sgst_rate':         float(ewb.sgst_rate),
        'igst_rate':         float(ewb.igst_rate),
        # Transport details
        'transporter_name':  ewb.transporter.name           if ewb.transporter else None,
        'transporter_gstin': ewb.transporter.gstin          if ewb.transporter else None,
        'vehicle_number':    ewb.vehicle.vehicle_number     if ewb.vehicle else None,
        'vehicle_type':      ewb.vehicle.vehicle_type       if ewb.vehicle else None,
        'timeline':          timeline,
    })


# ─── PUBLIC EWB TRACKING — path param style ─────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def track_ewb_path(request, ewb_number):
    if not ewb_number:
        return Response(
            {'error': 'EWB number is required.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        ewb = EWayBill.objects.select_related(
            'consignment', 'transporter', 'vehicle'
        ).get(ewb_number__iexact=ewb_number)
    except EWayBill.DoesNotExist:
        return Response(
            {'error': 'EWB not found.'},
            status=status.HTTP_404_NOT_FOUND
        )

    # FIX: Lazy-expire this single EWB before responding
    ewb = lazy_expire_single(ewb)

    updates  = ewb.shipment_updates.all().order_by('-timestamp')
    timeline = [
        {
            "status":       u.status,
            "status_label": u.get_status_display(),
            "location":     u.location,
            "note":         u.note,
            "timestamp":    u.timestamp,
            "latitude":     u.latitude,
            "longitude":    u.longitude,
        }
        for u in updates
    ]

    return Response({
        'ewb_number':        ewb.ewb_number,
        'status':            ewb.status,
        'valid_upto':        ewb.valid_upto,
        'distance_km':       ewb.distance_km,
        'origin':            ewb.consignment.origin         if ewb.consignment else None,
        'destination':       ewb.consignment.destination    if ewb.consignment else None,
        'consignment_no':    ewb.consignment.consignment_no if ewb.consignment else None,
        'hsn_code':          ewb.hsn_code,
        'goods_description': ewb.goods_description,
        'quantity':          float(ewb.quantity),
        'unit':              ewb.unit,
        'taxable_value':     float(ewb.taxable_value),
        'cgst_rate':         float(ewb.cgst_rate),
        'sgst_rate':         float(ewb.sgst_rate),
        'igst_rate':         float(ewb.igst_rate),
        'transporter_name':  ewb.transporter.name       if ewb.transporter else None,
        'transporter_gstin': ewb.transporter.gstin      if ewb.transporter else None,
        'vehicle_number':    ewb.vehicle.vehicle_number if ewb.vehicle else None,
        'vehicle_type':      ewb.vehicle.vehicle_type   if ewb.vehicle else None,
        'timeline':          timeline,
    })


# ─── CONTACT MESSAGE ────────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
def contact_message(request):
    first_name = request.data.get('firstName', '').strip()
    last_name  = request.data.get('lastName',  '').strip()
    email      = request.data.get('email',     '').strip()
    message    = request.data.get('message',   '').strip()

    if not first_name:
        return Response({'error': 'First name is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if not email:
        return Response({'error': 'Email is required.'},      status=status.HTTP_400_BAD_REQUEST)
    if not message:
        return Response({'error': 'Message is required.'},    status=status.HTTP_400_BAD_REQUEST)

    ContactMessage.objects.create(
        first_name=first_name,
        last_name=last_name,
        email=email,
        message=message,
    )

    return Response({'success': True, 'message': 'Message received! We will get back to you soon.'})


# ─── REPORTS ────────────────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def consignment_report(request):
    date_from = request.query_params.get('date_from')
    date_to   = request.query_params.get('date_to')

    queryset = Consignment.objects.all()

    dt_from, dt_to = parse_date_range(date_from, date_to)
    if dt_from:
        queryset = queryset.filter(booking_date__gte=dt_from)
    if dt_to:
        queryset = queryset.filter(booking_date__lte=dt_to)

    total   = queryset.count()
    revenue = queryset.aggregate(total=Sum('net_total_amt'))['total'] or 0

    by_service = list(queryset.values('service_type').annotate(count=Count('id')).order_by('-count'))
    by_payment = list(queryset.values('payment_mode').annotate(count=Count('id')).order_by('-count'))

    return Response({
        'total_consignments': total,
        'total_revenue':      float(revenue),
        'by_service_type':    by_service,
        'by_payment_mode':    by_payment,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ewaybill_report(request):
    date_from = request.query_params.get('date_from')
    date_to   = request.query_params.get('date_to')

    now = timezone.now()

    # FIX: Removed bulk auto-expire from read endpoint.
    # Use /api/ewaybills/expire-overdue/ (POST, admin) or management command instead.
    # The count may include a small number of just-expired EWBs — acceptable trade-off.

    queryset = EWayBill.objects.all()

    dt_from, dt_to = parse_date_range(date_from, date_to)
    if dt_from:
        queryset = queryset.filter(generated_date__gte=dt_from)
    if dt_to:
        queryset = queryset.filter(generated_date__lte=dt_to)

    by_status = list(queryset.values('status').annotate(count=Count('id')).order_by('status'))

    expiring_soon = queryset.filter(
        status='active',
        valid_upto__lte=now + timedelta(hours=24)
    ).count()

    return Response({
        'total':         queryset.count(),
        'by_status':     by_status,
        'expiring_soon': expiring_soon,
    })



# ─── EWB PDF DOWNLOAD ───────────────────────────────────────────────────────
from django.http import HttpResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
import io as _io

# ── Shared PDF helpers ───────────────────────────────────────────────────────
def _pdf_colors():
    return {
        'INDIGO':  colors.HexColor('#4338CA'),
        'INDIGO2': colors.HexColor('#6366F1'),
        'INDIGOL': colors.HexColor('#EEF2FF'),
        'INDIGOD': colors.HexColor('#1E1B4B'),
        'DARK':    colors.HexColor('#0F172A'),
        'GRAY':    colors.HexColor('#475569'),
        'LGRAY':   colors.HexColor('#94A3B8'),
        'LIGHT':   colors.HexColor('#F8FAFC'),
        'WHITE':   colors.white,
        'GREEN':   colors.HexColor('#059669'),
        'GREENL':  colors.HexColor('#DCFCE7'),
        'AMBER':   colors.HexColor('#D97706'),
        'AMBERL':  colors.HexColor('#FEF3C7'),
        'BORDER':  colors.HexColor('#E2E8F0'),
        'ROW':     colors.HexColor('#F8FAFC'),
    }

def _draw(c, x, y, text, font='Helvetica', size=9, color=None, align='left'):
    C = _pdf_colors()
    c.setFont(font, size)
    c.setFillColor(color or C['DARK'])
    s = str(text) if text else '—'
    if align == 'right':  c.drawRightString(x, y, s)
    elif align == 'center': c.drawCentredString(x, y, s)
    else: c.drawString(x, y, s)

def _rect(c, x, y, w, h, fill=None, stroke=None):
    if fill:   c.setFillColor(fill)
    if stroke: c.setStrokeColor(stroke)
    else:      c.setStrokeColor(colors.white)
    c.rect(x, y, w, h, fill=1 if fill else 0, stroke=1 if stroke else 0)

def _hline(c, x, y, w, col=None, lw=0.5):
    C = _pdf_colors()
    c.setStrokeColor(col or C['BORDER'])
    c.setLineWidth(lw)
    c.line(x, y, x+w, y)

def _vline(c, x, y1, y2, col=None, lw=0.5):
    C = _pdf_colors()
    c.setStrokeColor(col or C['BORDER'])
    c.setLineWidth(lw)
    c.line(x, y1, x, y2)

def _sec(c, x, y, w, title, bg=None):
    C = _pdf_colors()
    bg = bg or C['INDIGO']
    _rect(c, x, y-8*mm, w, 8*mm, fill=bg)
    _draw(c, x+4, y-5.5*mm, '  '+title, 'Helvetica-Bold', 9, C['WHITE'])
    return y - 8*mm

def _kv_row(c, x, y, cols, total_w, rh=26):
    """cols = [(label, value, width), ...]"""
    C = _pdf_colors()
    _rect(c, x, y-rh, total_w, rh, fill=C['WHITE'])
    c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
    c.rect(x, y-rh, total_w, rh, fill=0, stroke=1)
    cx = x
    for i, (lbl, val, cw) in enumerate(cols):
        if i > 0: _vline(c, cx, y-rh, y, C['BORDER'], 0.3)
        _draw(c, cx+4, y-rh+17, str(lbl), 'Helvetica-Bold', 6.5, C['LGRAY'])
        _draw(c, cx+4, y-rh+6,  str(val) if val else '—', 'Helvetica-Bold', 8.5, C['DARK'])
        cx += cw
    _hline(c, x, y-rh, total_w, C['BORDER'], 0.3)
    return y - rh


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ewaybill_pdf(request, pk):
    try:
        ewb = EWayBill.objects.select_related('consignment','transporter','vehicle','generated_by').get(pk=pk)
    except EWayBill.DoesNotExist:
        return Response({'error': 'E-Way Bill not found.'}, status=status.HTTP_404_NOT_FOUND)
    ewb = lazy_expire_single(ewb)

    C   = _pdf_colors()
    buf = _io.BytesIO()
    W, H = A4
    M   = 14*mm
    TW  = W - 2*M
    c   = rl_canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f'E-Way Bill {ewb.ewb_number}')
    y   = H - M

    STATUS_MAP = {
        'active':    (C['GREENL'], C['GREEN'],  '  ACTIVE'),
        'expired':   (C['AMBERL'], C['AMBER'],  '  EXPIRED'),
        'cancelled': (colors.HexColor('#FEE2E2'), colors.HexColor('#DC2626'), '  CANCELLED'),
        'delivered': (colors.HexColor('#DBEAFE'), colors.HexColor('#2563EB'), '  DELIVERED'),
    }
    st_bg, st_fg, st_txt = STATUS_MAP.get(ewb.status, (C['LIGHT'], C['GRAY'], ewb.status.upper()))

    # 1. HEADER
    _rect(c, M, y-22*mm, TW, 22*mm, fill=C['INDIGO'])
    _draw(c, M+4*mm,  y-9*mm,  'WayBill', 'Helvetica-Bold', 20, C['WHITE'])
    _draw(c, M+38*mm, y-9*mm,  'Pro',     'Helvetica-Bold', 20, colors.HexColor('#A5B4FC'))
    _draw(c, M+4*mm,  y-15*mm, 'Logistics & E-Way Bill Management', 'Helvetica', 8, colors.HexColor('#C7D2FE'))
    _draw(c, W-M-4, y-8*mm,  'E-WAY BILL', 'Helvetica-Bold', 16, C['WHITE'], 'right')
    _draw(c, W-M-4, y-15*mm, ewb.ewb_number, 'Helvetica-Bold', 11, colors.HexColor('#C7D2FE'), 'right')
    y -= 22*mm

    # 2. STATUS BAR
    bh = 14*mm
    chip_w = 28*mm
    _rect(c, M, y-bh, TW, bh, fill=C['LIGHT'])
    c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
    c.rect(M, y-bh, TW, bh, fill=0, stroke=1)
    _rect(c, M, y-bh, chip_w, bh, fill=st_bg)
    c.setFont('Helvetica-Bold', 9); c.setFillColor(st_fg)
    c.drawCentredString(M+chip_w/2, y-bh/2-3, st_txt)
    _vline(c, M+chip_w, y-bh, y, C['BORDER'], 0.3)

    gen_str   = ewb.created_at.strftime('%d %b %Y, %I:%M %p') if ewb.created_at else '—'
    valid_str = ewb.valid_upto.strftime('%d %b %Y, %I:%M %p') if ewb.valid_upto else '—'
    days      = ewb_validity_days(ewb.distance_km or 0)
    meta = [('GENERATED', gen_str), ('VALID UPTO', valid_str),
            ('DISTANCE / VALIDITY', f'{ewb.distance_km or 0} km  |  {days} day(s)'),
            ('GENERATED BY', ewb.generated_by.username if ewb.generated_by else '—')]
    mw = (TW - chip_w) / len(meta)
    mx = M + chip_w
    for lbl, val in meta:
        _vline(c, mx, y-bh, y, C['BORDER'], 0.3)
        _draw(c, mx+3, y-5,   lbl, 'Helvetica-Bold', 6,   C['LGRAY'])
        _draw(c, mx+3, y-12,  val, 'Helvetica-Bold', 7.5, C['AMBER'] if 'VALID' in lbl else C['DARK'])
        mx += mw
    y -= bh + 3*mm

    # 3. ROUTE BAR
    cns = ewb.consignment
    if cns and cns.origin:
        _rect(c, M, y-12*mm, TW, 12*mm, fill=C['INDIGOL'])
        c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
        c.rect(M, y-12*mm, TW, 12*mm, fill=0, stroke=1)
        _draw(c, M+4*mm,     y-4*mm,  'FROM', 'Helvetica-Bold', 6.5, C['LGRAY'])
        _draw(c, M+4*mm,     y-10*mm, cns.origin, 'Helvetica-Bold', 13, C['DARK'])
        _draw(c, M+TW*0.33,  y-7*mm,  '------->', 'Helvetica', 11, C['INDIGO2'])
        _draw(c, M+TW*0.48,  y-4*mm,  'TO', 'Helvetica-Bold', 6.5, C['LGRAY'])
        _draw(c, M+TW*0.48,  y-10*mm, cns.destination or '—', 'Helvetica-Bold', 13, C['DARK'])
        _vline(c, M+TW*0.72, y-12*mm, y, C['BORDER'], 0.3)
        for i, (lbl, val) in enumerate([('SERVICE', (cns.service_type or '').title()),
                                         ('PAYMENT', (cns.payment_mode or '').title())]):
            bx = M + TW*0.73 + i*(TW*0.135)
            _draw(c, bx, y-4*mm,  lbl, 'Helvetica-Bold', 6,   C['LGRAY'])
            _draw(c, bx, y-10*mm, val, 'Helvetica-Bold', 8.5, C['INDIGO2'])
        y -= 12*mm + 3*mm

    # 4. CONSIGNMENT DETAILS
    y = _sec(c, M, y, TW, 'CONSIGNMENT DETAILS')
    if cns:
        y = _kv_row(c, M, y, [
            ('Consignment No', cns.consignment_no, TW*0.4),
            ('Booking Date', cns.booking_date.strftime('%d %b %Y') if cns.booking_date else '—', TW*0.2),
            ('Consignor', cns.consignor_name or '—', TW*0.2),
            ('Consignee', cns.consignee_name or '—', TW*0.2),
        ], TW)
    else:
        y = _kv_row(c, M, y, [('Linked Consignment', 'None', TW)], TW)
    y -= 3*mm

    # 5. GOODS DETAILS
    y = _sec(c, M, y, TW, 'GOODS DETAILS')
    y = _kv_row(c, M, y, [
        ('HSN Code',    ewb.hsn_code or '—',          TW*0.2),
        ('Description', ewb.goods_description or '—', TW*0.4),
        ('Quantity',    f'{ewb.quantity or 0} {ewb.unit or ""}', TW*0.2),
        ('Category',    '—',                           TW*0.2),
    ], TW)
    y -= 3*mm

    # 6. TAX SUMMARY
    y = _sec(c, M, y, TW, 'TAX SUMMARY')
    tcols = [TW*0.45, TW*0.2, TW*0.35]
    _rect(c, M, y-8*mm, TW, 8*mm, fill=C['INDIGOD'])
    for i, (txt, tw) in enumerate(zip(['Description','Rate','Amount (Rs.)'], tcols)):
        bx = M + sum(tcols[:i])
        if i > 0: _vline(c, bx, y-8*mm, y, colors.HexColor('#4338CA'), 0.3)
        align = 'right' if i == 2 else 'left'
        if align == 'right':
            _draw(c, M+sum(tcols[:i+1])-3, y-5.5*mm, txt, 'Helvetica-Bold', 7, C['WHITE'], 'right')
        else:
            _draw(c, bx+4, y-5.5*mm, txt, 'Helvetica-Bold', 7, C['WHITE'])
    y -= 8*mm

    taxable = float(ewb.taxable_value or 0)
    cgst_a  = taxable * float(ewb.cgst_rate or 0) / 100
    sgst_a  = taxable * float(ewb.sgst_rate or 0) / 100
    igst_a  = taxable * float(ewb.igst_rate or 0) / 100
    total   = taxable + cgst_a + sgst_a + igst_a

    for i, (desc, rate, amt) in enumerate([
        ('Taxable Value', '—', taxable),
        (f'CGST', f'{ewb.cgst_rate or 0:.1f}%', cgst_a),
        (f'SGST', f'{ewb.sgst_rate or 0:.1f}%', sgst_a),
        (f'IGST', f'{ewb.igst_rate or 0:.1f}%', igst_a),
    ]):
        rh = 9*mm
        bg = C['LIGHT'] if i % 2 else C['WHITE']
        _rect(c, M, y-rh, TW, rh, fill=bg)
        c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
        c.rect(M, y-rh, TW, rh, fill=0, stroke=1)
        _vline(c, M+tcols[0], y-rh, y, C['BORDER'], 0.3)
        _vline(c, M+tcols[0]+tcols[1], y-rh, y, C['BORDER'], 0.3)
        _draw(c, M+4, y-rh+3, desc, 'Helvetica', 8.5, C['DARK'])
        _draw(c, M+tcols[0]+tcols[1]-3, y-rh+3, rate, 'Helvetica', 8.5, C['GRAY'], 'right')
        _draw(c, M+TW-3, y-rh+3, f'Rs. {amt:,.2f}', 'Helvetica', 8.5, C['DARK'], 'right')
        y -= rh

    # Total row
    _rect(c, M, y-11*mm, TW, 11*mm, fill=C['INDIGOL'])
    c.setStrokeColor(C['INDIGO']); c.setLineWidth(1)
    c.rect(M, y-11*mm, TW, 11*mm, fill=0, stroke=1)
    _draw(c, M+4, y-7.5*mm, 'TOTAL VALUE', 'Helvetica-Bold', 11, C['INDIGO'])
    _draw(c, M+TW-4, y-7.5*mm, f'Rs. {total:,.2f}', 'Helvetica-Bold', 13, C['GREEN'], 'right')
    y -= 11*mm + 3*mm

    # 7. TRANSPORT DETAILS
    y = _sec(c, M, y, TW, 'TRANSPORT DETAILS')
    y = _kv_row(c, M, y, [
        ('Transporter', ewb.transporter.name if ewb.transporter else '—', TW*0.35),
        ('Vehicle No',  ewb.vehicle.vehicle_number if ewb.vehicle else '—', TW*0.2),
        ('Vehicle Type',ewb.vehicle.vehicle_type if ewb.vehicle else '—', TW*0.2),
        ('Distance',    f'{ewb.distance_km or 0} km', TW*0.25),
    ], TW)
    y -= 3*mm

    # 8. FOOTER
    _hline(c, M, y-5*mm, TW, C['BORDER'], 0.5)
    _draw(c, W/2, y-9*mm,
          'This is a system-generated E-Way Bill document.  |  WayBillPro — Logistics Platform',
          'Helvetica', 6.5, C['LGRAY'], 'center')

    c.save()
    buf.seek(0)
    resp = HttpResponse(buf.read(), content_type='application/pdf')
    resp['Content-Disposition'] = f'attachment; filename="EWB_{ewb.ewb_number}.pdf"'
    return resp


# ─── CONSIGNMENT NOTE PDF ────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def consignment_pdf(request, pk):
    try:
        cns = Consignment.objects.select_related('customer','company','booked_by').get(pk=pk)
    except Consignment.DoesNotExist:
        return Response({'error': 'Consignment not found.'}, status=status.HTTP_404_NOT_FOUND)

    C   = _pdf_colors()
    buf = _io.BytesIO()
    W, H = A4
    M   = 14*mm
    TW  = W - 2*M
    c   = rl_canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f'Consignment Note {cns.consignment_no}')
    y   = H - M

    # 1. HEADER
    _rect(c, M, y-22*mm, TW, 22*mm, fill=C['INDIGO'])
    _draw(c, M+4*mm,  y-9*mm,  'WayBill', 'Helvetica-Bold', 20, C['WHITE'])
    _draw(c, M+38*mm, y-9*mm,  'Pro',     'Helvetica-Bold', 20, colors.HexColor('#A5B4FC'))
    _draw(c, M+4*mm,  y-15*mm, 'Logistics & E-Way Bill Management', 'Helvetica', 8, colors.HexColor('#C7D2FE'))
    _draw(c, W-M-4, y-8*mm,  'CONSIGNMENT NOTE', 'Helvetica-Bold', 13, C['WHITE'], 'right')
    _draw(c, W-M-4, y-14*mm, cns.consignment_no, 'Helvetica-Bold', 10, colors.HexColor('#C7D2FE'), 'right')
    _draw(c, W-M-4, y-19*mm, 'Date: '+(cns.booking_date.strftime('%d/%m/%Y') if cns.booking_date else '—'),
          'Helvetica', 8, colors.HexColor('#A5B4FC'), 'right')
    y -= 22*mm

    # 2. ROUTE BAR
    _rect(c, M, y-13*mm, TW, 13*mm, fill=C['INDIGOL'])
    c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
    c.rect(M, y-13*mm, TW, 13*mm, fill=0, stroke=1)
    _draw(c, M+4*mm,    y-4*mm,  'FROM', 'Helvetica-Bold', 6.5, C['LGRAY'])
    _draw(c, M+4*mm,    y-10*mm, cns.origin or '—', 'Helvetica-Bold', 12, C['DARK'])
    _draw(c, M+TW*0.32, y-7*mm,  '------->', 'Helvetica', 10, C['INDIGO2'])
    _draw(c, M+TW*0.46, y-4*mm,  'TO', 'Helvetica-Bold', 6.5, C['LGRAY'])
    _draw(c, M+TW*0.46, y-10*mm, cns.destination or '—', 'Helvetica-Bold', 12, C['DARK'])
    _vline(c, M+TW*0.68, y-13*mm, y, C['BORDER'], 0.3)
    meta = [('SERVICE', (cns.service_type or '').replace('_',' ').title()),
            ('PAYMENT', (cns.payment_mode or '').replace('_',' ').title()),
            ('DOC TYPE',(cns.doc_type or '').replace('_',' ').title())]
    for i, (lbl, val) in enumerate(meta):
        bx = M + TW*0.69 + i*(TW*0.103)
        _draw(c, bx, y-4*mm,  lbl, 'Helvetica-Bold', 6,   C['LGRAY'])
        _draw(c, bx, y-10*mm, val, 'Helvetica-Bold', 8, C['INDIGO2'])
    y -= 13*mm + 3*mm

    # 3. CONSIGNOR / CONSIGNEE side by side
    half = TW/2 - 1*mm
    top_y = y
    for side, name, mobile, addr, city, state, pin, gstin in [
        ('CONSIGNOR (SENDER)',
         cns.consignor_name or '—', cns.consignor_mobile or '—',
         cns.consignor_address or '—', cns.consignor_city or '—',
         cns.consignor_state or '—', cns.consignor_pincode or '—',
         getattr(cns,'consignor_gstin','')),
        ('CONSIGNEE (RECEIVER)',
         cns.consignee_name or '—', cns.consignee_mobile or '—',
         cns.consignee_address or '—', cns.consignee_city or '—',
         cns.consignee_state or '—', '—',
         getattr(cns,'consignee_gstin','')),
    ]:
        ox = M if 'CONSIGNOR' in side else M + TW/2 + 1*mm
        sy = top_y
        # Section bar
        _rect(c, ox, sy-8*mm, half, 8*mm, fill=C['INDIGO'])
        _draw(c, ox+3, sy-5.5*mm, '  '+side, 'Helvetica-Bold', 8.5, C['WHITE'])
        sy -= 8*mm
        # Name + mobile
        _rect(c, ox, sy-10*mm, half, 10*mm, fill=C['WHITE'])
        c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
        c.rect(ox, sy-10*mm, half, 10*mm, fill=0, stroke=1)
        _draw(c, ox+4, sy-6*mm, name, 'Helvetica-Bold', 10, C['DARK'])
        _draw(c, ox+4, sy-10*mm+2, f'Mobile: {mobile}', 'Helvetica', 7.5, C['GRAY'])
        sy -= 10*mm
        # Address
        _rect(c, ox, sy-10*mm, half, 10*mm, fill=C['LIGHT'])
        c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
        c.rect(ox, sy-10*mm, half, 10*mm, fill=0, stroke=1)
        _draw(c, ox+4, sy-5*mm, (addr[:42]+'..') if len(addr)>44 else addr, 'Helvetica', 8, C['GRAY'])
        _draw(c, ox+4, sy-10*mm+2, f'{city}, {state} - {pin}', 'Helvetica', 7.5, C['GRAY'])
        sy -= 10*mm
        # GSTIN
        _rect(c, ox, sy-7*mm, half, 7*mm, fill=C['WHITE'])
        c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
        c.rect(ox, sy-7*mm, half, 7*mm, fill=0, stroke=1)
        _draw(c, ox+4, sy-5*mm, 'GSTIN:', 'Helvetica-Bold', 7, C['LGRAY'])
        _draw(c, ox+24, sy-5*mm, gstin if gstin else '—', 'Helvetica-Bold', 8, C['INDIGO2'])
        sy -= 7*mm

    y = top_y - 8*mm - 10*mm - 10*mm - 7*mm - 3*mm

    # 4. SHIPMENT DETAILS
    y = _sec(c, M, y, TW, 'SHIPMENT DETAILS')
    cw = [TW*0.25, TW*0.09, TW*0.12, TW*0.12, TW*0.14, TW*0.14, TW*0.14]
    headers = ['DESCRIPTION','PIECES','ACTUAL WT','VOL. WT','CHARGEABLE WT','INVOICE NO.','CATEGORY']
    _rect(c, M, y-8*mm, TW, 8*mm, fill=C['INDIGOD'])
    cx = M
    for i, (h, w) in enumerate(zip(headers, cw)):
        if i > 0: _vline(c, cx, y-8*mm, y, colors.HexColor('#4338CA'), 0.3)
        _draw(c, cx+3, y-5.5*mm, h, 'Helvetica-Bold', 6.5, C['WHITE'])
        cx += w
    y -= 8*mm

    row_vals = [
        (cns.product_category or '—').replace('_',' ').title(),
        str(cns.total_pieces or 0),
        f'{float(cns.actual_weight or 0):.2f} kg',
        f'{float(cns.volumetric_weight or 0):.2f} kg',
        f'{float(cns.chargeable_weight or 0):.2f} kg',
        str(cns.invoice_number or '—'),
        (cns.product_category or '—').replace('_',' ').title(),
    ]
    _rect(c, M, y-9*mm, TW, 9*mm, fill=C['LIGHT'])
    c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
    c.rect(M, y-9*mm, TW, 9*mm, fill=0, stroke=1)
    cx = M
    for i, (val, w) in enumerate(zip(row_vals, cw)):
        if i > 0: _vline(c, cx, y-9*mm, y, C['BORDER'], 0.3)
        bold = (i == 4)
        _draw(c, cx+3, y-6*mm, val, 'Helvetica-Bold' if bold else 'Helvetica', 8.5, C['INDIGO'] if bold else C['DARK'])
        cx += w
    _hline(c, M, y-9*mm, TW, C['BORDER'], 0.3)
    y -= 9*mm + 3*mm

    # 5. BILLING (right half) + BOOKING INFO (left half)
    bw = TW * 0.5
    bx = M + TW - bw
    info_w = TW - bw - 2*mm

    freight  = float(cns.freight_amt  or 0)
    fsc      = float(cns.fsc_amt      or 0)
    other    = float(cns.other_charge or 0)
    subtotal = freight + fsc + other
    cgst_a   = float(cns.cgst or 0)
    sgst_a   = float(cns.sgst or 0)
    igst_a   = float(cns.igst or 0)
    net      = float(cns.net_total_amt or 0)
    cp = getattr(cns,'cgst_pct',0) or 0
    sp = getattr(cns,'sgst_pct',0) or 0
    ip = getattr(cns,'igst_pct',0) or 0

    _rect(c, bx, y-8*mm, bw, 8*mm, fill=C['INDIGO'])
    _draw(c, bx+4, y-5.5*mm, '  BILLING SUMMARY', 'Helvetica-Bold', 9, C['WHITE'])
    by = y - 8*mm
    bill_rows = [
        ('Freight Charges', freight, False),
        ('Fuel Surcharge (FSC)', fsc, False),
        ('Other Charges', other, False),
        ('Sub Total', subtotal, True),
        (f'CGST ({cp}%)', cgst_a, False),
        (f'SGST ({sp}%)', sgst_a, False),
        (f'IGST ({ip}%)', igst_a, False),
    ]
    for i, (desc, amt, bold) in enumerate(bill_rows):
        rh = 8*mm
        bg = C['INDIGOL'] if bold else (C['WHITE'] if i % 2 == 0 else C['LIGHT'])
        _rect(c, bx, by-rh, bw, rh, fill=bg)
        c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
        c.rect(bx, by-rh, bw, rh, fill=0, stroke=1)
        fn = 'Helvetica-Bold' if bold else 'Helvetica'
        _draw(c, bx+4, by-rh+3, desc, fn, 8.5, C['INDIGO'] if bold else C['DARK'])
        _draw(c, bx+bw-4, by-rh+3, f'Rs. {amt:,.2f}', fn, 8.5, C['INDIGO'] if bold else C['DARK'], 'right')
        by -= rh

    # Net total
    _rect(c, bx, by-11*mm, bw, 11*mm, fill=C['INDIGOL'])
    c.setStrokeColor(C['INDIGO']); c.setLineWidth(1)
    c.rect(bx, by-11*mm, bw, 11*mm, fill=0, stroke=1)
    _draw(c, bx+4, by-7.5*mm, 'NET TOTAL PAYABLE', 'Helvetica-Bold', 10, C['INDIGO'])
    _draw(c, bx+bw-4, by-7.5*mm, f'Rs. {net:,.2f}', 'Helvetica-Bold', 12, C['GREEN'], 'right')

    total_bill_h = 8*mm + len(bill_rows)*8*mm + 11*mm

    # BOOKING INFO (left of billing)
    _rect(c, M, y-8*mm, info_w, 8*mm, fill=C['INDIGOD'])
    _draw(c, M+4, y-5.5*mm, '  BOOKING INFO', 'Helvetica-Bold', 8, C['WHITE'])
    iy = y - 8*mm
    for lbl, val in [
        ('Delivery Type',    (cns.delivery_type or '—').replace('_',' ').title()),
        ('Freight Charged By',(cns.freight_charge_by or '—').replace('_',' ').title()),
        ('Currency',         'INR'),
        ('Booked By',        cns.booked_by.username if cns.booked_by else '—'),
        ('Booking Date',     cns.booking_date.strftime('%d %b %Y') if cns.booking_date else '—'),
    ]:
        _rect(c, M, iy-11, info_w, 11, fill=C['WHITE'])
        c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
        c.rect(M, iy-11, info_w, 11, fill=0, stroke=1)
        _draw(c, M+4, iy-4,  lbl, 'Helvetica-Bold', 6.5, C['LGRAY'])
        _draw(c, M+4, iy-10, val, 'Helvetica-Bold', 8, C['DARK'])
        iy -= 11

    y -= total_bill_h + 3*mm

    # 6. SIGNATURES
    _rect(c, M, y-18*mm, TW, 18*mm, fill=C['WHITE'])
    c.setStrokeColor(C['BORDER']); c.setLineWidth(0.3)
    c.rect(M, y-18*mm, TW, 18*mm, fill=0, stroke=1)
    sw = TW/3
    for i, lbl in enumerate(['Consignor Signature', 'Receiver Signature', 'Authorised Signatory']):
        sx = M + i * sw
        if i > 0: _vline(c, sx, y-18*mm, y, C['BORDER'], 0.3)
        _draw(c, sx+sw/2, y-8*mm, '_______________________', 'Helvetica', 8, C['LGRAY'], 'center')
        _draw(c, sx+sw/2, y-14*mm, lbl, 'Helvetica-Bold', 7.5, C['GRAY'], 'center')
    y -= 18*mm

    # 7. FOOTER
    _hline(c, M, y-5*mm, TW, C['BORDER'], 0.5)
    gen_str = cns.booking_date.strftime('%d %b %Y, %I:%M %p') if cns.booking_date else '—'
    _draw(c, W/2, y-9*mm,
          f'WayBillPro — Logistics & E-Way Bill Platform  |  System Generated  |  {gen_str}',
          'Helvetica', 6.5, C['LGRAY'], 'center')

    c.save()
    buf.seek(0)
    resp = HttpResponse(buf.read(), content_type='application/pdf')
    resp['Content-Disposition'] = f'attachment; filename="CNS_{cns.consignment_no}.pdf"'
    return resp


# ─── EMAIL ALERT CONFIG ──────────────────────────────────────────────────────
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def email_alert_config(request):
    """GET: return current config.  POST: save config. Admin only."""
    if not request.user.is_staff and request.user.role != 'admin':
        return Response({'error': 'Admin access required.'}, status=403)

    cfg, _ = EmailAlertConfig.objects.get_or_create(id=1)

    if request.method == 'GET':
        return Response({
            'enabled':               cfg.enabled,
            'recipient_emails':      cfg.recipient_emails_list,
            'alert_hours_before':    cfg.alert_hours_before,
            'send_time':             cfg.send_time,
            'include_ewb_details':   cfg.include_ewb_details,
            'include_goods_details': cfg.include_goods_details,
            'notify_on_cancel':      cfg.notify_on_cancel,
            'last_run':              cfg.last_run,
            'last_run_count':        cfg.last_run_count,
        })

    # POST — save
    data = request.data
    cfg.enabled               = bool(data.get('enabled',               cfg.enabled))
    cfg.alert_hours_before    = int(data.get('alert_hours_before',     cfg.alert_hours_before))
    cfg.send_time             = data.get('send_time',                  cfg.send_time)
    cfg.include_ewb_details   = bool(data.get('include_ewb_details',   cfg.include_ewb_details))
    cfg.include_goods_details = bool(data.get('include_goods_details', cfg.include_goods_details))
    cfg.notify_on_cancel      = bool(data.get('notify_on_cancel',      cfg.notify_on_cancel))

    emails = data.get('recipient_emails', [])
    cfg.recipient_emails = ','.join(emails) if isinstance(emails, list) else emails
    cfg.save()
    return Response({'status': 'saved'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def email_alert_test(request):
    """Send a test email to all configured recipients."""
    if not request.user.is_staff and request.user.role != 'admin':
        return Response({'error': 'Admin access required.'}, status=403)

    emails = request.data.get('emails', [])
    if not emails:
        return Response({'error': 'No recipients provided.'}, status=400)

    try:
        send_mail(
            subject='WayBillPro — Test Email Alert',
            message=(
                'This is a test email from WayBillPro.\n\n'
                'Your email alert configuration is working correctly.\n'
                'You will receive real expiry alerts when E-Way Bills are close to expiring.\n\n'
                '— WayBillPro System'
            ),
            from_email=django_settings.DEFAULT_FROM_EMAIL,
            recipient_list=emails,
            fail_silently=False,
        )
        return Response({'status': 'sent'})
    except Exception as e:
        return Response({'error': str(e)}, status=500)