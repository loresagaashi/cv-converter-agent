from django.urls import path

from .views import CVUploadView

app_name = 'cv'

urlpatterns = [
    path('upload/', CVUploadView.as_view(), name='upload'),
]

