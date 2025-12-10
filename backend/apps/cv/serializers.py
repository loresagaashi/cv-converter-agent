from rest_framework import serializers

from .models import CV


class CVSerializer(serializers.ModelSerializer):
    class Meta:
        model = CV
        fields = ('id', 'file', 'original_filename', 'uploaded_at')
        read_only_fields = ('id', 'original_filename', 'uploaded_at')
        extra_kwargs = {'file': {'write_only': True}}

    def create(self, validated_data):
        request = self.context['request']
        uploaded_file = validated_data['file']
        return CV.objects.create(
            user=request.user,
            original_filename=uploaded_file.name,
            **validated_data,
        )

