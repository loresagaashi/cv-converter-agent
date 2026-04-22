from django.urls import path

from . import views

urlpatterns = [
    path("index/", views.IndexCVView.as_view(), name="vector-search-index"),
    path("index/bulk/", views.BulkIndexView.as_view(), name="vector-search-bulk-index"),
    path("match/", views.MatchView.as_view(), name="vector-search-match"),
    path("status/", views.StatusView.as_view(), name="vector-search-status"),
    path("index/<int:cv_id>/", views.RemoveIndexView.as_view(), name="vector-search-remove"),
]
