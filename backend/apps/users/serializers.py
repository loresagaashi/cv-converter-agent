from django.contrib.auth import authenticate, get_user_model
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'email', 'first_name', 'last_name', 'date_joined')
        read_only_fields = ('id', 'email', 'date_joined')


class SignupSerializer(serializers.ModelSerializer):
    # Password validation is handled by the auth backend; we allow any length here
    # so you can use simpler passwords if desired.
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ('id', 'email', 'first_name', 'last_name', 'password')
        read_only_fields = ('id',)

    def create(self, validated_data):
        password = validated_data.pop('password')
        return User.objects.create_user(password=password, **validated_data)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        email = attrs.get('email')
        password = attrs.get('password')
        user = authenticate(
            request=self.context.get('request'),
            email=email,
            password=password,
        )
        if not user:
            raise serializers.ValidationError(
                _('Unable to log in with provided credentials.'),
                code='authorization',
            )
        if not user.is_active:
            raise serializers.ValidationError(_('User account is disabled.'), code='authorization')

        attrs['user'] = user
        return attrs

