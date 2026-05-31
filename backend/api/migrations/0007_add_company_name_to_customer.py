from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0006_add_gstin_to_consignment'),
    ]

    operations = [
        migrations.AddField(
            model_name='customer',
            name='company_name',
            field=models.CharField(max_length=200, blank=True, default=''),
            preserve_default=False,
        ),
    ]