from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_add_company_name_to_customer'),
    ]

    operations = [
        migrations.AddField(
            model_name='customer',
            name='city',
            field=models.CharField(max_length=100, blank=True, default=''),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='customer',
            name='state',
            field=models.CharField(max_length=100, blank=True, default=''),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='customer',
            name='pincode',
            field=models.CharField(max_length=10, blank=True, default=''),
            preserve_default=False,
        ),
    ]