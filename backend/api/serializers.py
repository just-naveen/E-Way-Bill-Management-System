from rest_framework import serializers
from django.contrib.auth.hashers import make_password
from .models import User, Company, Customer, Transporter, Vehicle, Consignment, EWayBill, ShipmentUpdate


class UserSerializer(serializers.ModelSerializer):
    confirm_password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model  = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'mobile', 'is_active', 'date_joined',
            'password', 'confirm_password',
        ]
        extra_kwargs = {
            'password':    {'write_only': True, 'required': False, 'allow_blank': True},
            'username':    {'required': False},
            'date_joined': {'read_only': True},
        }

    def create(self, validated_data):
        validated_data.pop('confirm_password', None)
        if not validated_data.get('username'):
            base = validated_data['email'].split('@')[0].lower().replace('.','_').replace('+','_')
            username = base
            counter  = 1
            while User.objects.filter(username=username).exists():
                username = f'{base}_{counter}'
                counter += 1
            validated_data['username'] = username
        raw = validated_data.pop('password', None)
        validated_data['password'] = make_password(raw) if raw else make_password(User.objects.make_random_password())
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('confirm_password', None)
        raw = validated_data.pop('password', None)
        if raw:
            validated_data['password'] = make_password(raw)
        return super().update(instance, validated_data)


class CompanySerializer(serializers.ModelSerializer):
    class Meta:
        model  = Company
        fields = '__all__'


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Customer
        fields = '__all__'


class TransporterSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Transporter
        fields = '__all__'


class VehicleSerializer(serializers.ModelSerializer):
    transporter_name = serializers.CharField(
        source='transporter.name', read_only=True, allow_null=True, default=None
    )

    class Meta:
        model  = Vehicle
        fields = '__all__'


class ConsignmentSerializer(serializers.ModelSerializer):
    customer_name  = serializers.CharField(source='customer.name',      read_only=True, allow_null=True, default=None)
    company_name   = serializers.CharField(source='company.name',       read_only=True, allow_null=True, default=None)
    booked_by_name = serializers.CharField(source='booked_by.username', read_only=True, allow_null=True, default=None)

    class Meta:
        model  = Consignment
        fields = '__all__'


class EWayBillSerializer(serializers.ModelSerializer):
    transporter_name = serializers.CharField(source='transporter.name',           read_only=True, allow_null=True, default=None)
    vehicle_number   = serializers.CharField(source='vehicle.vehicle_number',     read_only=True, allow_null=True, default=None)
    consignment_no   = serializers.CharField(source='consignment.consignment_no', read_only=True, allow_null=True, default=None)
    generated_by_name = serializers.CharField(source='generated_by.username',    read_only=True, allow_null=True, default=None)

    class Meta:
        model  = EWayBill
        fields = '__all__'


# ── NEW: Shipment Timeline ───────────────────────────────────────────────────
class ShipmentUpdateSerializer(serializers.ModelSerializer):
    """
    Serializes each timeline step for the public tracking page.
    status_label gives the human-readable display name (e.g. '🚛 In Transit').
    """
    status_label = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model  = ShipmentUpdate
        fields = ['id', 'status', 'status_label', 'location', 'note', 'timestamp']