from django.core.management.base import BaseCommand
from api.models import Company, Customer, Transporter, Vehicle, Consignment, EWayBill, User
from django.utils import timezone
from datetime import timedelta
import random


class Command(BaseCommand):
    help = 'Seed sample data for testing'

    def handle(self, *args, **kwargs):
        self.stdout.write('Seeding data...')

        # Company
        company, _ = Company.objects.get_or_create(
            name='Metro Swift Logistics',
            defaults={
                'address': '123 MG Road, Chennai',
                'mobile': '9876543210',
                'gstin': '33AABCT1332L1ZU',
            }
        )
        self.stdout.write('✅ Company created')

        # Customers
        customers_data = [
            {'name': 'Rajesh Kumar', 'mobile': '9876543211', 'email': 'rajesh@gmail.com', 'address': 'Anna Nagar, Chennai', 'gstin': '33AABCT1332L1ZX'},
            {'name': 'Priya Logistics', 'mobile': '9876543212', 'email': 'priya@gmail.com', 'address': 'T Nagar, Chennai'},
            {'name': 'Kumar Enterprises', 'mobile': '9876543213', 'email': 'kumar@gmail.com', 'address': 'Coimbatore'},
            {'name': 'Sri Ram Traders', 'mobile': '9876543214', 'email': 'sriram@gmail.com', 'address': 'Madurai'},
            {'name': 'Global Exports', 'mobile': '9876543215', 'email': 'global@gmail.com', 'address': 'Trichy'},
        ]
        customers = []
        for cd in customers_data:
            c, _ = Customer.objects.get_or_create(name=cd['name'], defaults=cd)
            customers.append(c)
        self.stdout.write('✅ Customers created')

        # Transporters
        transporters_data = [
            {'name': 'Blue Dart Transport', 'mobile': '9876500001', 'gstin': '33AABCT1332L1ZV', 'address': 'Chennai'},
            {'name': 'DTDC Logistics', 'mobile': '9876500002', 'gstin': '33AABCT1332L1ZW', 'address': 'Bangalore'},
            {'name': 'Delhivery Express', 'mobile': '9876500003', 'gstin': '33AABCT1332L1ZY', 'address': 'Delhi'},
        ]
        transporters = []
        for td in transporters_data:
            t, _ = Transporter.objects.get_or_create(name=td['name'], defaults=td)
            transporters.append(t)
        self.stdout.write('✅ Transporters created')

        # Vehicles
        vehicles_data = [
            {'vehicle_number': 'TN01AB1234', 'vehicle_type': 'HCV', 'transporter': transporters[0]},
            {'vehicle_number': 'TN02CD5678', 'vehicle_type': 'LCV', 'transporter': transporters[0]},
            {'vehicle_number': 'KA03EF9012', 'vehicle_type': 'Trailer', 'transporter': transporters[1]},
            {'vehicle_number': 'MH04GH3456', 'vehicle_type': 'Container', 'transporter': transporters[2]},
        ]
        vehicles = []
        for vd in vehicles_data:
            v, _ = Vehicle.objects.get_or_create(
                vehicle_number=vd['vehicle_number'],
                defaults=vd
            )
            vehicles.append(v)
        self.stdout.write('✅ Vehicles created')

        # Get admin user
        admin_user = User.objects.filter(is_superuser=True).first()

        # Consignments
        origins = ['Chennai', 'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad']
        destinations = ['Coimbatore', 'Pune', 'Kolkata', 'Mysore', 'Vizag']
        service_types = ['standard', 'express', 'overnight']
        payment_modes = ['credit', 'cash', 'online']

        for i in range(10):
            cn = f'CNS{random.randint(100000, 999999)}'
            if not Consignment.objects.filter(consignment_no=cn).exists():
                actual_weight = random.uniform(1, 50)
                rate = random.uniform(10, 50)
                freight = actual_weight * rate
                cgst = freight * 0.09
                sgst = freight * 0.09
                net_total = freight + cgst + sgst

                Consignment.objects.create(
                    consignment_no=cn,
                    booking_date=timezone.now() - timedelta(days=random.randint(0, 30)),
                    customer=random.choice(customers),
                    origin=random.choice(origins),
                    destination=random.choice(destinations),
                    service_type=random.choice(service_types),
                    consignor_name=random.choice(customers).name,
                    consignor_city=random.choice(origins),
                    consignor_mobile='987654321' + str(random.randint(0, 9)),
                    consignee_name=random.choice(customers).name,
                    consignee_city=random.choice(destinations),
                    total_pieces=random.randint(1, 10),
                    actual_weight=round(actual_weight, 2),
                    chargeable_weight=round(actual_weight, 2),
                    invoice_value=round(random.uniform(1000, 50000), 2),
                    invoice_number=f'INV{random.randint(1000, 9999)}',
                    payment_mode=random.choice(payment_modes),
                    rate_per_kg=round(rate, 2),
                    freight_amt=round(freight, 2),
                    cgst=round(cgst, 2),
                    sgst=round(sgst, 2),
                    total_amt=round(freight, 2),
                    net_total_amt=round(net_total, 2),
                    company=company,
                    delivery_type='door_delivery',
                    freight_charge_by='consignor',
                    doc_type='non_documents',
                    booked_by=admin_user,
                    product_category='electronics',
                )

        self.stdout.write('✅ Consignments created')

        # EWayBills
        consignments = Consignment.objects.all()[:5]
        statuses = ['active', 'active', 'active', 'expired', 'delivered']

        for i, consignment in enumerate(consignments):
            ewb_num = str(random.randint(1000000000, 9999999999))
            if not EWayBill.objects.filter(ewb_number=ewb_num).exists():
                EWayBill.objects.create(
                    ewb_number=ewb_num,
                    consignment=consignment,
                    valid_upto=timezone.now() + timedelta(days=random.randint(-2, 10)),
                    status=statuses[i],
                    hsn_code=f'{random.randint(1000, 9999)}',
                    goods_description='Electronic Goods',
                    quantity=random.randint(1, 10),
                    unit='NOS',
                    taxable_value=round(random.uniform(5000, 50000), 2),
                    cgst_rate=9,
                    sgst_rate=9,
                    igst_rate=0,
                    transporter=random.choice(transporters),
                    vehicle=random.choice(vehicles),
                    distance_km=random.randint(100, 1000),
                    generated_by=admin_user,
                )

        self.stdout.write('✅ E-Way Bills created')
        self.stdout.write(self.style.SUCCESS('🎉 All sample data seeded successfully!'))
