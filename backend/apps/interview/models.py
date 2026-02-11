from django.conf import settings
from django.db import models
from apps.cv.models import CV


class CompetencePaper(models.Model):
    """Store original competence papers only (from CV export)"""
    
    cv = models.ForeignKey(
        CV,
        on_delete=models.CASCADE,
        related_name='competence_papers',
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'competence_paper'
        ordering = ('-created_at',)
        verbose_name = 'Competence Paper'
        verbose_name_plural = 'Competence Papers'
        indexes = [
            models.Index(fields=['cv', 'created_at']),
        ]
    
    def __str__(self):
        return f'{self.cv.original_filename} - Original'


class ConversationCompetencePaper(models.Model):
    """Store conversation-based competence papers (after interview/conversation)"""
    
    conversation_session = models.ForeignKey(
        'ConversationSession',
        on_delete=models.CASCADE,
        related_name='conversation_competence_papers',
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'conversation_competencepaper'
        ordering = ('-created_at',)
        verbose_name = 'Conversation Competence Paper'
        verbose_name_plural = 'Conversation Competence Papers'
        indexes = [
            models.Index(fields=['conversation_session', 'created_at']),
        ]
    
    def __str__(self):
        return f'Conversation Paper for {self.conversation_session.cv.original_filename}'


class ConversationSession(models.Model):
    """Conversation session metadata and results"""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
    ]
    
    cv = models.ForeignKey(
        CV,
        on_delete=models.CASCADE,
        related_name='conversation_sessions',
    )
    original_competence_paper = models.ForeignKey(
        CompetencePaper,
        on_delete=models.CASCADE,
        related_name='original_conversations',
    )
    conversation_competence_paper = models.ForeignKey(
        'ConversationCompetencePaper',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='conversation_sessions',
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'conversation_session'
        ordering = ('-created_at',)
        verbose_name = 'Conversation Session'
        verbose_name_plural = 'Conversation Sessions'
        indexes = [
            models.Index(fields=['cv', 'status']),
        ]
    
    def __str__(self):
        return f'Conversation for {self.cv.original_filename} - {self.get_status_display()}'


class ConversationQuestion(models.Model):
    """Questions asked during conversation"""
    
    SECTION_CHOICES = [
        ("core_skills", "Core Skills"),
        ("soft_skills", "Soft Skills"),
        ("languages", "Languages"),
        ("education", "Education"),
        ("trainings_certifications", "Trainings & Certifications"),
        ("technical_competencies", "Technical Competencies"),
        ("project_experience", "Project Experience"),
        ("recommendations", "Recommendations"),
        ("additional_info", "Additional Information"),
    ]

    CATEGORY_CHOICES = [
        ('work_experience', 'Work Experience'),
        ('skill', 'Skill'),
        ('language', 'Language'),
        ('training', 'Training'),
        ('education', 'Education'),
        ('certification', 'Certification'),
        ('project', 'Project'),
        ('discovery', 'Discovery'),
        ('recommendation', 'Recommendation'),
        ('other', 'Other'),
    ]
    
    PHASE_CHOICES = [
        ('validation', 'Validation'),
        ('discovery', 'Discovery'),
    ]

    session = models.ForeignKey(
        ConversationSession,
        on_delete=models.CASCADE,
        related_name='questions',
    )
    section = models.CharField(
        max_length=50,
        choices=SECTION_CHOICES,
        default='core_skills',
        help_text='Logical section this question belongs to (e.g., core_skills, soft_skills, etc.)',
    )
    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES,
    )
    topic = models.CharField(
        max_length=255,
        help_text='What specifically is being asked about (e.g., "Python", "5 years at Google")',
    )
    question_text = models.TextField(
        help_text='The actual question',
    )
    question_order = models.IntegerField(
        help_text='Order in sequence',
    )
    phase = models.CharField(
        max_length=20,
        choices=PHASE_CHOICES,
        default='validation',
    )
    asked_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'conversation_question'
        ordering = ('question_order', 'asked_at')
        verbose_name = 'Conversation Question'
        verbose_name_plural = 'Conversation Questions'
        indexes = [
            models.Index(fields=['session', 'question_order']),
            models.Index(fields=['category']),
        ]
    
    def __str__(self):
        return f'Q{self.question_order}: {self.topic} ({self.get_category_display()})'


class ConversationResponse(models.Model):
    """HR's detailed answers to each question"""
    
    STATUS_CHOICES = [
        ('confirmed', 'Confirmed'),
        ('partially_confirmed', 'Partially Confirmed'),
        ('not_confirmed', 'Not Confirmed'),
        ('new_skill', 'New Skill'),
    ]
    
    CONFIDENCE_CHOICES = [
        ('high', 'High'),
        ('medium', 'Medium'),
        ('low', 'Low'),
    ]
    
    question = models.OneToOneField(
        ConversationQuestion,
        on_delete=models.CASCADE,
        related_name='response',
    )
    answer_text = models.TextField(
        help_text='Full transcribed answer from HR',
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
    )
    confidence_level = models.CharField(
        max_length=10,
        choices=CONFIDENCE_CHOICES,
        null=True,
        blank=True,
    )
    extracted_skills = models.JSONField(
        default=list,
        blank=True,
        help_text='If new skills mentioned, store them here',
    )
    notes = models.TextField(
        blank=True,
        help_text='Additional processing notes',
    )
    answered_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'conversation_response'
        ordering = ('answered_at',)
        verbose_name = 'Conversation Response'
        verbose_name_plural = 'Conversation Responses'
    
    def __str__(self):
        return f'Response to: {self.question.topic} - {self.get_status_display()}'

