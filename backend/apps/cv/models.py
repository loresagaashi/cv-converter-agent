import os

from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.db import models


def cv_upload_path(instance, filename):
    return os.path.join('cvs', f'user_{instance.user_id}', filename)


class CV(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='cvs',
    )
    file = models.FileField(
        upload_to=cv_upload_path,
        validators=[FileExtensionValidator(['pdf', 'docx'])],
    )
    original_filename = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('-uploaded_at',)
        verbose_name = 'CV'
        verbose_name_plural = 'CVs'

    def __str__(self):
        return f'{self.user.email} - {self.original_filename}'
