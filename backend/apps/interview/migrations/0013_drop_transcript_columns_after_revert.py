from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0012_competencepaper_status"),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                "ALTER TABLE conversation_session DROP COLUMN IF EXISTS transcript;",
                "ALTER TABLE conversation_session DROP COLUMN IF EXISTS extracted_sections;",
            ],
            reverse_sql=[
                "ALTER TABLE conversation_session ADD COLUMN IF NOT EXISTS transcript jsonb;",
                "ALTER TABLE conversation_session ADD COLUMN IF NOT EXISTS extracted_sections jsonb;",
            ],
        ),
    ]
