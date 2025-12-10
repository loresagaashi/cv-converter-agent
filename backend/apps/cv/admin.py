from django.contrib import admin

from .models import CV


@admin.register(CV)
class CVAdmin(admin.ModelAdmin):
    list_display = ('original_filename', 'user', 'uploaded_at')
    search_fields = ('original_filename', 'user__email')
    list_filter = ('uploaded_at',)
