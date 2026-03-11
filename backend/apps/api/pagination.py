"""
Pagination utilities for API endpoints.
"""
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class StandardPagination(PageNumberPagination):
    """
    Standard pagination for list endpoints.
    Default: 50 records per page
    Query params: ?page=1&page_size=50
    """
    page_size = 50
    page_size_query_param = 'page_size'
    page_size_query_description = 'Number of results to return per page.'
    max_page_size = 1000

    def get_paginated_response(self, data):
        """
        Custom response format with pagination metadata.
        """
        return Response({
            'data': data,
            'totalRecords': self.page.paginator.count,
            'currentPage': self.page.number,
            'pageSize': self.get_page_size(self.request),
            'totalPages': self.page.paginator.num_pages,
            'hasNext': self.page.has_next(),
            'hasPrevious': self.page.has_previous(),
        })
