from django.contrib import admin
from .models import (
    User, Company, Customer, Transporter,
    Vehicle, Consignment, EWayBill, ContactMessage,
    ShipmentUpdate   # ✅ ADD THIS
)

# ── Existing models ──────────────────────────────────────
admin.site.register(User)
admin.site.register(Company)
admin.site.register(Customer)
admin.site.register(Transporter)
admin.site.register(Vehicle)
admin.site.register(Consignment)
admin.site.register(EWayBill)

# ── Shipment Updates (Tracking Timeline) ─────────────────
@admin.register(ShipmentUpdate)
class ShipmentUpdateAdmin(admin.ModelAdmin):
    list_display = ('ewb', 'status', 'location', 'timestamp')
    list_filter = ('status',)
    search_fields = ('ewb__ewb_number', 'location')
    ordering = ('-timestamp',)

# ── Contact Messages ─────────────────────────────────────
@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display  = ('first_name', 'last_name', 'email', 'status', 'created_at')
    list_filter   = ('status', 'created_at')
    search_fields = ('first_name', 'last_name', 'email', 'message')
    readonly_fields = ('first_name', 'last_name', 'email', 'message', 'created_at')
    ordering      = ('-created_at',)

    # Mark as read when opened
    def change_view(self, request, object_id, form_url='', extra_context=None):
        obj = self.get_object(request, object_id)
        if obj and obj.status == 'new':
            obj.status = 'read'
            obj.save()
        return super().change_view(request, object_id, form_url, extra_context)

    # Show unread count in admin
    def get_list_display_links(self, request, list_display):
        return ['first_name']

    list_per_page = 25