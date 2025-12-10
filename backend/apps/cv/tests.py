import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import CV


class CVUploadViewTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.temp_media = tempfile.mkdtemp()
        cls.override = override_settings(MEDIA_ROOT=cls.temp_media)
        cls.override.enable()

    @classmethod
    def tearDownClass(cls):
        cls.override.disable()
        shutil.rmtree(cls.temp_media, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email='uploader@example.com',
            password='Passw0rd!',
        )
        self.client.force_authenticate(self.user)
        self.url = reverse('cv:upload')

    def test_user_can_upload_pdf(self):
        file = SimpleUploadedFile(
            'resume.pdf',
            b'%PDF-1.4 test file',
            content_type='application/pdf',
        )

        response = self.client.post(self.url, {'file': file}, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['original_filename'], 'resume.pdf')
        self.assertEqual(CV.objects.filter(user=self.user).count(), 1)

    def test_rejects_invalid_file_extension(self):
        file = SimpleUploadedFile(
            'resume.txt',
            b'Plain text',
            content_type='text/plain',
        )

        response = self.client.post(self.url, {'file': file}, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('file', response.data)

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        file = SimpleUploadedFile(
            'resume.pdf',
            b'%PDF-1.4 test file',
            content_type='application/pdf',
        )

        response = self.client.post(self.url, {'file': file}, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
