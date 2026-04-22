from django.contrib import admin

from .models import CvEmbedding


@admin.register(CvEmbedding)
class CvEmbeddingAdmin(admin.ModelAdmin):
    list_display = ("profile_id", "created_at", "updated_at")
    search_fields = ("profile_id",)
    readonly_fields = ("created_at", "updated_at")
