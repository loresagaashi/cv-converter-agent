from django.urls import path

from .views import (
    AdminUserDetailView,
    AdminUserListCreateView,
    CurrentUserView,
    LoginView,
    SignupView,
)

app_name = "users"

urlpatterns = [
    path("signup/", SignupView.as_view(), name="signup"),
    path("login/", LoginView.as_view(), name="login"),
    path("me/", CurrentUserView.as_view(), name="me"),
    # Admin user management endpoints (RBAC-protected)
    path("", AdminUserListCreateView.as_view(), name="admin-user-list-create"),
    path("<int:pk>/", AdminUserDetailView.as_view(), name="admin-user-detail"),
]

