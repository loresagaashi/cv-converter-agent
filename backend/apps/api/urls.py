from django.urls import path

from .views import ConvertCVView, ProxyDebugHeadersView

app_name = "api"

urlpatterns = [
    path("convert/", ConvertCVView.as_view(), name="convert"),
    path("debug/proxy-headers/", ProxyDebugHeadersView.as_view(), name="debug-proxy-headers"),
]


