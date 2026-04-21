from rest_framework import serializers


class IndexCVSerializer(serializers.Serializer):
    cv_id = serializers.IntegerField()


class BulkIndexSerializer(serializers.Serializer):
    cv_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=None,
    )
    all = serializers.BooleanField(required=False, default=False)


class MatchRequestSerializer(serializers.Serializer):
    job_description = serializers.CharField(max_length=10000)
    top_k = serializers.IntegerField(min_value=1, max_value=20, default=5)
    include_gap_analysis = serializers.BooleanField(default=False)
