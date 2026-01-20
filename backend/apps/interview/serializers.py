from rest_framework import serializers

from apps.interview.models import CompetencePaper, ConversationCompetencePaper


class CompetencePaperSerializer(serializers.ModelSerializer):
    """
    Serializer for CompetencePaper model (original papers only).
    Includes computed fields for preview and related CV/user information.
    """
    
    preview = serializers.SerializerMethodField()
    cv_id = serializers.IntegerField(source='cv.id', read_only=True)
    cv_filename = serializers.SerializerMethodField()
    user_email = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    paper_type = serializers.SerializerMethodField()  # Always returns 'original'
    
    class Meta:
        model = CompetencePaper
        fields = (
            'id',
            'cv_id',
            'paper_type',
            'content',
            'created_at',
            'preview',
            'cv_filename',
            'user_email',
            'user_name',
        )
        read_only_fields = ('id', 'cv_id', 'paper_type', 'created_at', 'preview', 'cv_filename', 'user_email', 'user_name')
    
    def get_paper_type(self, obj):
        """Always return 'original' since this model only stores original papers"""
        return 'original'
    
    def get_preview(self, obj: CompetencePaper) -> str:
        """Return first 150 characters of content as preview."""
        if not obj.content:
            return ""
        return obj.content[:150] + "..." if len(obj.content) > 150 else obj.content
    
    def get_cv_filename(self, obj: CompetencePaper) -> str:
        """Return the CV's original filename."""
        return obj.cv.original_filename if hasattr(obj, 'cv') and obj.cv else ""
    
    def get_user_email(self, obj: CompetencePaper) -> str:
        """Return the CV owner's email."""
        if hasattr(obj, 'cv') and obj.cv and hasattr(obj.cv, 'user'):
            return obj.cv.user.email
        return ""
    
    def get_user_name(self, obj: CompetencePaper) -> str:
        """Return the CV owner's full name or email."""
        if hasattr(obj, 'cv') and obj.cv and hasattr(obj.cv, 'user'):
            user = obj.cv.user
            full_name = f"{user.first_name} {user.last_name}".strip()
            return full_name or user.email
        return ""


class CompetencePaperListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing competence papers (without full content).
    Used when listing papers for a specific CV.
    """
    
    preview = serializers.SerializerMethodField()
    cv_id = serializers.IntegerField(source='cv.id', read_only=True)
    paper_type = serializers.SerializerMethodField()  # Always returns 'original'
    
    class Meta:
        model = CompetencePaper
        fields = (
            'id',
            'cv_id',
            'paper_type',
            'content',
            'created_at',
            'preview',
        )
        read_only_fields = ('id', 'cv_id', 'paper_type', 'created_at', 'preview')
    
    def get_paper_type(self, obj):
        """Always return 'original' since this model only stores original papers"""
        return 'original'
    
    def get_preview(self, obj: CompetencePaper) -> str:
        """Return first 150 characters of content as preview."""
        if not obj.content:
            return ""
        return obj.content[:150] + "..." if len(obj.content) > 150 else obj.content


class ConversationCompetencePaperSerializer(serializers.ModelSerializer):
    """
    Serializer for ConversationCompetencePaper model (conversation-based papers).
    Includes computed fields for preview and related CV/user information.
    """
    
    preview = serializers.SerializerMethodField()
    cv_id = serializers.IntegerField(source='conversation_session.cv.id', read_only=True)
    cv_filename = serializers.SerializerMethodField()
    user_email = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    paper_type = serializers.SerializerMethodField()  # Always returns 'conversation_based'
    session_id = serializers.IntegerField(source='conversation_session.id', read_only=True)
    
    class Meta:
        model = ConversationCompetencePaper
        fields = (
            'id',
            'cv_id',
            'session_id',
            'paper_type',
            'content',
            'created_at',
            'preview',
            'cv_filename',
            'user_email',
            'user_name',
        )
        read_only_fields = ('id', 'cv_id', 'session_id', 'paper_type', 'created_at', 'preview', 'cv_filename', 'user_email', 'user_name')
    
    def get_paper_type(self, obj):
        """Always return 'conversation_based' since this model only stores conversation-based papers"""
        return 'conversation_based'
    
    def get_preview(self, obj: ConversationCompetencePaper) -> str:
        """Return first 150 characters of content as preview."""
        if not obj.content:
            return ""
        return obj.content[:150] + "..." if len(obj.content) > 150 else obj.content
    
    def get_cv_filename(self, obj: ConversationCompetencePaper) -> str:
        """Return the CV's original filename."""
        if hasattr(obj, 'conversation_session') and obj.conversation_session and hasattr(obj.conversation_session, 'cv'):
            return obj.conversation_session.cv.original_filename
        return ""
    
    def get_user_email(self, obj: ConversationCompetencePaper) -> str:
        """Return the CV owner's email."""
        if hasattr(obj, 'conversation_session') and obj.conversation_session and hasattr(obj.conversation_session, 'cv') and hasattr(obj.conversation_session.cv, 'user'):
            return obj.conversation_session.cv.user.email
        return ""
    
    def get_user_name(self, obj: ConversationCompetencePaper) -> str:
        """Return the CV owner's full name or email."""
        if hasattr(obj, 'conversation_session') and obj.conversation_session and hasattr(obj.conversation_session, 'cv') and hasattr(obj.conversation_session.cv, 'user'):
            user = obj.conversation_session.cv.user
            full_name = f"{user.first_name} {user.last_name}".strip()
            return full_name or user.email
        return ""

