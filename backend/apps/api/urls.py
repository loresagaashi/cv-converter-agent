from django.urls import path

from .views import ConvertCVView

app_name = "api"

urlpatterns = [
    path("convert/", ConvertCVView.as_view(), name="convert"),
]


