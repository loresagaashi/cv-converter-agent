from rest_framework import serializers

from .models import CV


class CVSerializer(serializers.ModelSerializer):
    """
    Basic serializer for CV uploads/listing.

    Exposes a read-only ``uploaded_by`` string so the frontend can display
    who uploaded the CV in table views, without having to nest the full
    user object.
    """

    uploaded_by = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CV
        fields = ('id', 'file', 'original_filename', 'uploaded_at', 'uploaded_by')
        read_only_fields = ('id', 'original_filename', 'uploaded_at', 'uploaded_by')
        extra_kwargs = {'file': {'write_only': True}}

    def get_uploaded_by(self, obj: CV) -> str:
        user = getattr(obj, "user", None)
        if not user:
            return ""

        full_name = (getattr(user, "first_name", "") + " " + getattr(user, "last_name", "")).strip()
        return full_name or getattr(user, "email", "") or ""

    def create(self, validated_data):
        request = self.context['request']
        uploaded_file = validated_data['file']
        return CV.objects.create(
            user=request.user,
            original_filename=uploaded_file.name,
            **validated_data,
        )

