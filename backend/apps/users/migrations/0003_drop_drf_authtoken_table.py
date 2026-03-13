from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_refreshtoken"),
    ]

    operations = [
        migrations.RunSQL(
            sql="DROP TABLE IF EXISTS authtoken_token;",
            reverse_sql="""
            CREATE TABLE IF NOT EXISTS authtoken_token (
                key varchar(40) PRIMARY KEY,
                created timestamp with time zone NOT NULL,
                user_id bigint NOT NULL UNIQUE REFERENCES users_user(id)
                    DEFERRABLE INITIALLY DEFERRED
            );
            """,
        ),
    ]