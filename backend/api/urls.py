from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'users',        views.UserViewSet)
router.register(r'companies',    views.CompanyViewSet)
router.register(r'customers',    views.CustomerViewSet)
router.register(r'transporters', views.TransporterViewSet)
router.register(r'vehicles',     views.VehicleViewSet)
router.register(r'consignments', views.ConsignmentViewSet)
router.register(r'ewaybills',    views.EWayBillViewSet)

urlpatterns = [
    # ── EWB custom endpoints (must be BEFORE router include so DRF
    #    doesn't treat these slugs as a pk lookup) ──────────────────
    path('ewaybills/bulk-upload/',          views.bulk_upload_ewaybills,  name='ewaybills-bulk-upload'),
    path('ewaybills/bulk-upload/template/', views.bulk_upload_template,   name='ewaybills-bulk-template'),
    path('ewaybills/expiring/',             views.expiring_ewaybills,     name='ewaybills-expiring'),
    path('ewaybills/expire-overdue/',       views.expire_overdue_ewbs,    name='ewaybills-expire-overdue'),
    path('ewaybills/<int:pk>/pdf/',         views.ewaybill_pdf,           name='ewaybill-pdf'),
    path('consignments/<int:pk>/pdf/',      views.consignment_pdf,        name='consignment-pdf'),

    # ── Router (ViewSets) ──────────────────────────────────────────
    path('', include(router.urls)),

    # ── Auth ───────────────────────────────────────────────────────
    path('auth/login/',  views.login,  name='login'),
    path('auth/logout/', views.logout, name='logout'),

    # ── Dashboard & Reports ────────────────────────────────────────
    path('dashboard/stats/',      views.dashboard_stats,    name='dashboard-stats'),
    path('reports/consignments/', views.consignment_report, name='consignment-report'),
    path('reports/ewaybills/',    views.ewaybill_report,    name='ewaybill-report'),

    # ── Public ────────────────────────────────────────────────────
    path('contact/', views.contact_message, name='contact-message'),
    path('track/',   views.track_ewb,       name='track-ewb'),

    # ── Email Alerts ───────────────────────────────────────────────
    path('email-alerts/config/', views.email_alert_config, name='email-alert-config'),
    path('email-alerts/test/',   views.email_alert_test,   name='email-alert-test'),
]