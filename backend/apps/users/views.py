from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import (
    AdminUserSerializer,
    LoginSerializer,
    SignupSerializer,
    UserSerializer,
)

User = get_user_model()


class SignupView(generics.CreateAPIView):
    serializer_class = SignupSerializer
    permission_classes = [AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        data = UserSerializer(user, context=self.get_serializer_context()).data
        data["token"] = token.key
        headers = self.get_success_headers(data)
        return Response(data, status=status.HTTP_201_CREATED, headers=headers)


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
        token, _ = Token.objects.get_or_create(user=user)
        data = UserSerializer(user, context={"request": request}).data
        data["token"] = token.key
        return Response(data, status=status.HTTP_200_OK)


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
    permission_classes = [IsAdminUser]


class AdminUserDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    Admin-only endpoint to retrieve, update or delete individual users.

    Deletion is hard delete; use with care.
    """

    queryset = User.objects.all().order_by("email")
    serializer_class = AdminUserSerializer
    permission_classes = [IsAdminUser]
