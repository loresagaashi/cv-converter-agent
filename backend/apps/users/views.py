import hashlib
import secrets
from datetime import timedelta

import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import (
    AdminUserSerializer,
    LoginSerializer,
    SignupSerializer,
    UserSerializer,
)
from .models import RefreshToken
from .permissions import RolePermission

User = get_user_model()

ACCESS_TOKEN_TTL_MINUTES = 15
REFRESH_TOKEN_TTL_DAYS = 7
REFRESH_TOKEN_COOKIE_NAME = "refresh_token"
REFRESH_TOKEN_COOKIE_SAMESITE = getattr(settings, "COOKIE_SAMESITE", "Lax")


def build_access_token(user) -> str:
    now = timezone.now()
    payload = {
        "user_id": user.id,
        "role": "admin" if getattr(user, "is_staff", False) else "user",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)).timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def create_refresh_token(user):
    token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = timezone.now() + timedelta(days=REFRESH_TOKEN_TTL_DAYS)
    RefreshToken.objects.create(
        user=user,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    return token, expires_at


class SignupView(generics.CreateAPIView):
    serializer_class = SignupSerializer
    permission_classes = [AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        access_token = build_access_token(user)
        refresh_token, _ = create_refresh_token(user)
        data = UserSerializer(user, context=self.get_serializer_context()).data
        data["access_token"] = access_token
        headers = self.get_success_headers(data)
        response = Response(data, status=status.HTTP_201_CREATED, headers=headers)
        response.set_cookie(
            "access_token",
            access_token,
            max_age=ACCESS_TOKEN_TTL_MINUTES * 60,
            httponly=False,
            secure=True,
            samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
        )
        response.set_cookie(
            REFRESH_TOKEN_COOKIE_NAME,
            refresh_token,
            max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
            httponly=True,
            secure=True,
            samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
        )
        return response


class LoginView(APIView):
    permission_classes = [AllowAny]
    # Disable default SessionAuthentication here to avoid CSRF issues for
    # token-based login from the SPA frontend.
    authentication_classes: list = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        access_token = build_access_token(user)
        refresh_token, _ = create_refresh_token(user)

        data = UserSerializer(user, context={"request": request}).data
        data["access_token"] = access_token

        response = Response(data, status=status.HTTP_200_OK)
        response.set_cookie(
            "access_token",
            access_token,
            max_age=ACCESS_TOKEN_TTL_MINUTES * 60,
            httponly=False,
            secure=True,
            samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
        )
        response.set_cookie(
            REFRESH_TOKEN_COOKIE_NAME,
            refresh_token,
            max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
            httponly=True,
            secure=True,
            samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
        )
        return response


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        refresh_token = request.COOKIES.get(REFRESH_TOKEN_COOKIE_NAME)
        if refresh_token:
            token_hash = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
            RefreshToken.objects.filter(token_hash=token_hash).delete()

        response = Response(status=status.HTTP_204_NO_CONTENT)
        # Clear both refresh_token and access_token cookies
        response.set_cookie(
            REFRESH_TOKEN_COOKIE_NAME,
            "",
            max_age=0,
            expires=0,
            httponly=True,
            secure=True,
            samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
        )
        response.set_cookie(
            "access_token",
            "",
            max_age=0,
            expires=0,
            httponly=False,
            secure=True,
            samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
        )
        return response


class RenewAccessTokenView(APIView):
    """
    Refresh endpoint: validates refresh_token from cookie and issues new access_token.
    If refresh_token is missing or invalid, returns 401 (frontend should redirect to login).
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        refresh_token = request.COOKIES.get(REFRESH_TOKEN_COOKIE_NAME)
        if not refresh_token:
            return Response(
                {"detail": "Refresh token missing. Please login again."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        token_hash = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
        try:
            rt = RefreshToken.objects.get(token_hash=token_hash)
        except RefreshToken.DoesNotExist:
            return Response(
                {"detail": "Invalid refresh token. Please login again."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Check if expired
        if rt.expires_at < timezone.now():
            rt.delete()
            return Response(
                {"detail": "Refresh token expired. Please login again."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Validate user still exists
        user = rt.user
        if not user.is_active:
            return Response(
                {"detail": "User account is inactive. Please login again."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Generate new access token
        new_access_token = build_access_token(user)

        # Return new access token
        data = {
            "access_token": new_access_token,
            "user_id": user.id,
            "email": user.email,
        }
        response = Response(data, status=status.HTTP_200_OK)

        # Set new access token in cookie (frontend will read from cookie)
        response.set_cookie(
            "access_token",
            new_access_token,
            max_age=ACCESS_TOKEN_TTL_MINUTES * 60,
            httponly=False,
            secure=True,
            samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
        )

        return response


class CurrentUserView(APIView):
    """
    Simple read-only endpoint to fetch the currently authenticated user.

    This is useful for frontend apps that need to hydrate auth state based
    on an existing token without performing a fresh login.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = UserSerializer(request.user, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)


class AdminUserListCreateView(generics.ListCreateAPIView):
    """
    Admin-only endpoint to list all users and create new ones.

    Access is restricted to users with the ``admin`` role (``is_staff=True``).
    """

    queryset = User.objects.all().order_by("email")
    serializer_class = AdminUserSerializer
    permission_classes = [IsAuthenticated, RolePermission]
    required_roles = ["admin"]


class AdminUserDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    Admin-only endpoint to retrieve, update or delete individual users.

    Deletion is hard delete; use with care.
    """

    queryset = User.objects.all().order_by("email")
    serializer_class = AdminUserSerializer
    permission_classes = [IsAuthenticated, RolePermission]
    required_roles = ["admin"]
