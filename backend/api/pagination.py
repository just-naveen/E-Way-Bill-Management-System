from rest_framework.pagination import PageNumberPagination


class DynamicPageSizePagination(PageNumberPagination):
    """
    FIX: Angular sends ?page=1&page_size=10 but Django's default
    PageNumberPagination only reads ?page= and ignores ?page_size=.
    This class reads page_size from the request so the rows-per-page
    selector in the frontend actually works.

    Supports: ?page=2&page_size=25
    Max allowed: 100 rows per page (prevents huge queries)
    Default fallback: 10 rows (matches PAGE_SIZE in settings.py)
    """
    page_size             = 10          # default if no ?page_size= in request
    page_size_query_param = 'page_size' # matches Angular: ?page_size=10
    max_page_size         = 100         # safety cap