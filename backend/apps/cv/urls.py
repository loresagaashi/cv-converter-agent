from django.urls import path

from .views import CVTextView, CVUploadView

app_name = 'cv'

urlpatterns = [
    path('upload/', CVUploadView.as_view(), name='upload'),
    path('<int:pk>/text/', CVTextView.as_view(), name='text'),
]

