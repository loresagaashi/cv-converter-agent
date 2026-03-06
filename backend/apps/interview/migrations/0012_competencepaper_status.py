from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('interview', '0011_conversationsession_cv_extracted_text'),
    ]

    operations = [
        migrations.AddField(
            model_name='competencepaper',
            name='status',
            field=models.CharField(
                blank=True,
                choices=[
                    ('borek_assessed', 'Borek Assessed'),
                    ('borek_employee_assessed', 'Borek Employee & Assessed'),
                    ('market_research', 'Market Research'),
                ],
                default='',
                help_text='Assessment status shown in the footer badge of the CP PDF',
                max_length=30,
            ),
        ),
    ]
