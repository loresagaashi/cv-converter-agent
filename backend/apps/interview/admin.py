from django.contrib import admin
from .models import CompetencePaper, ConversationCompetencePaper, ConversationSession, ConversationQuestion, ConversationResponse


@admin.register(CompetencePaper)
class CompetencePaperAdmin(admin.ModelAdmin):
    list_display = ('cv', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('cv__original_filename', 'content')
    readonly_fields = ('created_at',)


@admin.register(ConversationCompetencePaper)
class ConversationCompetencePaperAdmin(admin.ModelAdmin):
    list_display = ('conversation_session', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('content', 'conversation_session__cv__original_filename')
    readonly_fields = ('created_at',)


@admin.register(ConversationSession)
class ConversationSessionAdmin(admin.ModelAdmin):
    list_display = ('cv', 'status', 'created_at', 'completed_at')
    list_filter = ('status', 'created_at')
    search_fields = ('cv__original_filename',)
    readonly_fields = ('created_at', 'completed_at')


@admin.register(ConversationQuestion)
class ConversationQuestionAdmin(admin.ModelAdmin):
    list_display = ('session', 'category', 'topic', 'question_order', 'phase', 'asked_at')
    list_filter = ('category', 'phase', 'asked_at')
    search_fields = ('topic', 'question_text')
    readonly_fields = ('asked_at',)


@admin.register(ConversationResponse)
class ConversationResponseAdmin(admin.ModelAdmin):
    list_display = ('question', 'status', 'confidence_level', 'answered_at')
    list_filter = ('status', 'confidence_level', 'answered_at')
    search_fields = ('answer_text',)
    readonly_fields = ('answered_at',)

