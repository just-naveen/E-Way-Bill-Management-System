# Generated migration: adds consignor_gstin and consignee_gstin to Consignment
from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_emailalertconfig'),  # ← matches your last migration
    ]

    operations = [
        migrations.AddField(
            model_name='consignment',
            name='consignor_gstin',
            field=models.CharField(max_length=20, blank=True, default=''),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='consignment',
            name='consignee_gstin',
            field=models.CharField(max_length=20, blank=True, default=''),
            preserve_default=False,
        ),
    ]