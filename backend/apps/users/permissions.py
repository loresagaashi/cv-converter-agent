from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import BasePermission


class RolePermission(BasePermission):
    message = "You do not have permission to access this resource."

    def has_permission(self, request, view):
        required_roles = getattr(view, "required_roles", None)
        if not required_roles:
            return True

        if not request.user or not request.user.is_authenticated:
            raise NotAuthenticated("Authentication credentials were not provided.")

        user_role = "admin" if getattr(request.user, "is_staff", False) else "user"
        return user_role in required_roles
