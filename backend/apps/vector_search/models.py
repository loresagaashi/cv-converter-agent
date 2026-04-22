from django.db import models
from pgvector.django import VectorField


class CvEmbedding(models.Model):
    profile_id = models.CharField(max_length=255, primary_key=True)
    embedding = VectorField(dimensions=1536)
    document = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cv_embeddings"
