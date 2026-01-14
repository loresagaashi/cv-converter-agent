from django.urls import path

from .views import CVDetailView, CVTextView, CVUploadView, FormattedCVView, StructuredCVView

app_name = "cv"

urlpatterns = [
    path("upload/", CVUploadView.as_view(), name="upload"),
    path("<int:pk>/", CVDetailView.as_view(), name="detail"),
    path("<int:pk>/text/", CVTextView.as_view(), name="text"),
    path("<int:pk>/structured/", StructuredCVView.as_view(), name="structured"),
    path("<int:pk>/formatted/", FormattedCVView.as_view(), name="formatted"),
]

