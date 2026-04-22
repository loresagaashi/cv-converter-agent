import pgvector.django
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        pgvector.django.VectorExtension(),
        migrations.CreateModel(
            name="CvEmbedding",
            fields=[
                (
                    "profile_id",
                    models.CharField(max_length=255, primary_key=True, serialize=False),
                ),
                (
                    "embedding",
                    pgvector.django.VectorField(dimensions=1536),
                ),
                ("document", models.TextField(blank=True, default="")),
                ("metadata", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "cv_embeddings",
            },
        ),
    ]
