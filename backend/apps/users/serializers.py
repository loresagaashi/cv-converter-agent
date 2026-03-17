from django.contrib.auth import get_user_model
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .models import RefreshToken

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """
    Public-facing user serializer used for auth responses.

    Exposes a derived ``role`` field so the frontend can perform simple
    role-based UI checks without needing to know about ``is_staff``.
    """

    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "date_joined",
            "last_login",
            "role",
        )
        read_only_fields = ("id", "email", "date_joined", "last_login", "role")

    def get_role(self, obj) -> str:
        return "admin" if getattr(obj, "is_staff", False) else "user"


class SignupSerializer(serializers.ModelSerializer):
    # Password validation is handled by the auth backend; we allow any length here
    # so you can use simpler passwords if desired.
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "password")
        read_only_fields = ("id",)

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError(_("A user with this email already exists."))
        return email

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["email"] = validated_data["email"].lower()
        # New signups are regular users by default (non-admin).
        return User.objects.create_user(password=password, **validated_data)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip().lower()
        password = attrs.get("password")

        user = User.objects.filter(email__iexact=email).first()
        if not user or not user.check_password(password):
            raise serializers.ValidationError(
                _("Unable to log in with provided credentials."),
                code="authorization",
            )
        if not user.is_active:
            raise serializers.ValidationError(
                _("User account is disabled."), code="authorization"
            )

        attrs["email"] = email
        attrs["user"] = user
        return attrs


class AuthResponseSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()
    first_name = serializers.CharField(allow_blank=True)
    last_name = serializers.CharField(allow_blank=True)
    date_joined = serializers.DateTimeField()
    role = serializers.CharField()
    access_token = serializers.CharField()


class RenewAccessTokenResponseSerializer(serializers.Serializer):
    access_token = serializers.CharField()
    user_id = serializers.IntegerField()
    email = serializers.EmailField()


class AdminUserSerializer(serializers.ModelSerializer):
    """
    Serializer used by the admin-only user management API.

    - Allows managing first/last name, email, password and role.
    - The ``role`` field is mapped to ``is_staff`` under the hood.
    """

    # ``role`` is accepted when writing and mapped to ``is_staff``.
    # For reads we inject it manually in ``to_representation`` so DRF does not
    # try to fetch a non-existent ``role`` attribute from the model.
    role = serializers.ChoiceField(choices=("admin", "user"), write_only=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "password",
            "date_joined",
            "last_login",
            "role",
        )
        read_only_fields = ("id", "date_joined", "last_login")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Ensure role stays in sync with the stored flags when serializing.
        data["role"] = "admin" if getattr(instance, "is_staff", False) else "user"
        # Never expose the password hash.
        data.pop("password", None)
        return data

    def create(self, validated_data):
        role = validated_data.pop("role", "user")
        password = validated_data.pop("password", "").strip()

        is_staff = role == "admin"

        user = User(
            **validated_data,
        )
        user.is_staff = is_staff
        # Admin-created users are never superusers by default.
        if hasattr(user, "is_superuser"):
            user.is_superuser = False

        if password:
            user.set_password(password)
        else:
            # Force unusable password so the account cannot be logged into until
            # a password is explicitly set.
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        role = validated_data.pop("role", None)
        password = validated_data.pop("password", "").strip()

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if role is not None:
            instance.is_staff = role == "admin"

        if password:
            instance.set_password(password)

        instance.save()
        return instance


class AdminRefreshTokenSessionSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_first_name = serializers.CharField(source="user.first_name", read_only=True)
    user_last_name = serializers.CharField(source="user.last_name", read_only=True)

    class Meta:
        model = RefreshToken
        fields = (
            "id",
            "user_id",
            "user_email",
            "user_first_name",
            "user_last_name",
            "created_at",
            "expires_at",
        )
        read_only_fields = fields


class ClearExpiredRefreshTokensResponseSerializer(serializers.Serializer):
    deleted_count = serializers.IntegerField()

