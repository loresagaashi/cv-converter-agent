from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import CV


@receiver(post_delete, sender=CV)
def delete_cv_file_from_cloudinary(sender, instance, **kwargs):
    """
    Deletes the file from Cloudinary when the CV instance is deleted.
    """
    if instance.file:
        # Pass save=False to avoid saving the model instance while trying to delete it
        instance.file.delete(save=False)
