from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase


class SignupViewTests(APITestCase):
    def test_user_can_signup(self):
        payload = {
            'email': 'test@example.com',
            'first_name': 'Test',
            'last_name': 'User',
            'password': 'Passw0rd!',
        }
        response = self.client.post(reverse('users:signup'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('token', response.data)
        self.assertEqual(response.data['email'], payload['email'])


class LoginViewTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email='login@example.com',
            password='Passw0rd!',
            first_name='Login',
            last_name='User',
        )

    def test_user_can_login(self):
        payload = {'email': 'login@example.com', 'password': 'Passw0rd!'}
        response = self.client.post(reverse('users:login'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('token', response.data)
        self.assertEqual(response.data['email'], self.user.email)
