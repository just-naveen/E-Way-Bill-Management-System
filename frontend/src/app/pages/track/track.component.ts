import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';                // ← FIX: added
import { takeUntil } from 'rxjs/operators';    // ← FIX: added
import { environment } from '../../../environments/environment';

declare const L: any;

@Component({
  selector: 'app-track',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './track.component.html',
  styleUrls: ['./track.component.css']
})
export class TrackComponent implements OnInit, OnDestroy {
  ewbNo    = '';
  focused  = false;
  loading  = false;
  result: any = null;
  notFound = false;
  error    = '';

  private map: any = null;
  private destroy$ = new Subject<void>();  // ← FIX: added

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {}

  ngOnInit() {
    // FIX: takeUntil added so queryParams subscription is cleaned up on destroy
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        if (params['q']) { this.ewbNo = params['q']; this.search(); }
      });
  }

  ngOnDestroy() {
    // FIX: completes destroy$ to cancel all active subscriptions
    this.destroy$.next();
    this.destroy$.complete();
    this.destroyMap();
  }

  search() {
    const num = this.ewbNo.trim();
    if (!num) return;

    this.loading  = true;
    this.result   = null;
    this.notFound = false;
    this.error    = '';
    this.destroyMap();

    // FIX: takeUntil added — prevents callback firing on destroyed component
    this.http.get(`${environment.apiUrl}/track/`, { params: { ewb_number: num } })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.zone.run(() => {
            this.loading = false;
            if (res && res.ewb_number) {
              this.result = this.mapEwb(res);
            } else {
              this.notFound = true;
            }
            this.cdr.detectChanges();

            setTimeout(() => {
              const el = document.querySelector('.result-section') as HTMLElement;
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

              if (this.result?.hasMapPoints) {
                this.initMap();
                this.cdr.detectChanges();
              }
            }, 100);
          });
        },
        error: (err) => {
          this.zone.run(() => {
            this.loading = false;
            if (err.status === 404)    this.notFound = true;
            else if (err.status === 0) this.tryDemo();
            else this.error = err?.error?.error || err?.error?.detail || 'Unable to reach the server.';
            this.cdr.detectChanges();

            setTimeout(() => {
              const el = document.querySelector('.not-found') as HTMLElement;
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
          });
        }
      });
  }

  clear() {
    this.ewbNo    = '';
    this.result   = null;
    this.notFound = false;
    this.error    = '';
    this.loading  = false;
    this.destroyMap();
    this.cdr.detectChanges();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private initMap() {
    if (!this.result || !this.result.mapPoints?.length) return;
    if (typeof L === 'undefined') {
      console.warn('Leaflet not loaded.');
      return;
    }
    this.destroyMap();
    this.map = L.map('shipment-map').setView(
      [this.result.mapPoints[0].lat, this.result.mapPoints[0].lng], 6
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(this.map);
    const points: [number, number][] = [];
    this.result.mapPoints.forEach((pt: any, i: number) => {
      const isFirst = i === 0;
      const isLast  = i === this.result.mapPoints.length - 1;
      const color   = isFirst ? '#16a34a' : isLast ? '#dc2626' : '#6366f1';
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7]
      });
      L.marker([pt.lat, pt.lng], { icon }).addTo(this.map).bindPopup(`
        <strong>${pt.status_label}</strong><br>
        📍 ${pt.location}<br>
        🕐 ${new Date(pt.timestamp).toLocaleString('en-IN')}
        ${pt.note ? '<br><em>' + pt.note + '</em>' : ''}
      `);
      points.push([pt.lat, pt.lng]);
    });
    if (points.length > 1) {
      L.polyline(points, { color: '#6366f1', weight: 3, dashArray: '6,4' }).addTo(this.map);
      this.map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    }
  }

  private destroyMap() {
    if (this.map) { this.map.remove(); this.map = null; }
  }

  private tryDemo() {
    const now = new Date();
    const h   = (n: number) => new Date(now.getTime() + n * 3600000).toISOString();
    const demos: Record<string, any> = {
      '1234567890': {
        ewb_number: '1234567890', consignment_no: 'CNS-2026-03142',
        status: 'active', origin: 'Chennai, TN', destination: 'Mumbai, MH', distance_km: 1338,
        valid_upto: h(36),
        hsn_code: '8471', goods_description: 'Laptop computers & accessories',
        quantity: 10, unit: 'NOS', taxable_value: 500000,
        cgst_rate: 9, sgst_rate: 9, igst_rate: 0,
        transporter_name: 'Express Logistics Pvt Ltd',
        transporter_gstin: '33AABCE1234F1Z5',
        vehicle_number: 'TN09AB1234',
        vehicle_type: 'Truck',
        timeline: [
          { id:1, status:'booked',     status_label:'📋 Booked',     location:'Chennai, TN',  note:'Consignment booked.',           timestamp: h(-48), latitude: 13.0827, longitude: 80.2707 },
          { id:2, status:'picked_up',  status_label:'📦 Picked Up',  location:'Chennai Hub',  note:'Shipment picked up.',           timestamp: h(-36), latitude: 13.0900, longitude: 80.2800 },
          { id:3, status:'in_transit', status_label:'🚛 In Transit', location:'Pune Hub, MH', note:'Vehicle MH04GH3456. En route.', timestamp: h(-12), latitude: 18.5204, longitude: 73.8567 },
        ]
      },
      '9981234567': {
        ewb_number: '9981234567', consignment_no: null,
        status: 'delivered', origin: 'Coimbatore, TN', destination: 'Delhi, DL', distance_km: 2174,
        valid_upto: h(-48),
        hsn_code: '6203', goods_description: 'Men\'s suits & blazers',
        quantity: 200, unit: 'PCS', taxable_value: 320000,
        cgst_rate: 0, sgst_rate: 0, igst_rate: 12,
        transporter_name: 'FastMove Transport Co.',
        transporter_gstin: '29AABCF5678G1Z2',
        vehicle_number: 'KA05CD5678',
        vehicle_type: 'Container Truck',
        timeline: [
          { id:1, status:'booked',           status_label:'📋 Booked',           location:'Coimbatore, TN', note:'', timestamp: h(-120), latitude: 11.0168, longitude: 76.9558 },
          { id:2, status:'picked_up',        status_label:'📦 Picked Up',        location:'Coimbatore Hub', note:'', timestamp: h(-108), latitude: 11.0200, longitude: 76.9600 },
          { id:3, status:'in_transit',       status_label:'🚛 In Transit',       location:'Bangalore Hub',  note:'Transferred at sorting hub.', timestamp: h(-84),  latitude: 12.9716, longitude: 77.5946 },
          { id:4, status:'at_hub',           status_label:'🏭 At Hub',           location:'Delhi Hub, DL',  note:'Arrived at destination hub.', timestamp: h(-60),  latitude: 28.6139, longitude: 77.2090 },
          { id:5, status:'out_for_delivery', status_label:'🛵 Out for Delivery', location:'New Delhi, DL',  note:'', timestamp: h(-53), latitude: 28.6200, longitude: 77.2100 },
          { id:6, status:'delivered',        status_label:'✅ Delivered',        location:'New Delhi, DL',  note:'Received by consignee.', timestamp: h(-48), latitude: 28.6250, longitude: 77.2150 },
        ]
      },
      '2345678901': {
        ewb_number: '2345678901', consignment_no: 'CNS-2026-04011',
        status: 'active', origin: 'Bangalore, KA', destination: 'Hyderabad, TS', distance_km: 574,
        valid_upto: h(8),
        hsn_code: '7308', goods_description: 'Iron & steel structural products',
        quantity: 5000, unit: 'KGS', taxable_value: 750000,
        cgst_rate: 9, sgst_rate: 9, igst_rate: 0,
        transporter_name: 'ShreeJi Roadways',
        transporter_gstin: '36AABCS9012H1Z8',
        vehicle_number: 'KA03C1234',
        vehicle_type: 'Heavy Truck',
        timeline: [
          { id:1, status:'booked',           status_label:'📋 Booked',           location:'Bangalore, KA', note:'', timestamp: h(-12), latitude: 12.9716, longitude: 77.5946 },
          { id:2, status:'picked_up',        status_label:'📦 Picked Up',        location:'Bangalore Hub', note:'', timestamp: h(-10), latitude: 12.9800, longitude: 77.6000 },
          { id:3, status:'in_transit',       status_label:'🚛 In Transit',       location:'Kurnool, AP',   note:'Vehicle KA03C1234.',     timestamp: h(-5),  latitude: 15.8281, longitude: 78.0373 },
          { id:4, status:'out_for_delivery', status_label:'🛵 Out for Delivery', location:'Hyderabad, TS', note:'Expected by end of day.', timestamp: h(-1),  latitude: 17.3850, longitude: 78.4867 },
        ]
      },
    };
    const key = Object.keys(demos).find(k => k === this.ewbNo.trim().replace(/\D/g, ''));
    if (key) {
      this.result = this.mapEwb(demos[key]);
      this.cdr.detectChanges();
      setTimeout(() => {
        const el = document.querySelector('.result-section') as HTMLElement;
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (this.result.hasMapPoints) { this.initMap(); this.cdr.detectChanges(); }
      }, 100);
    } else {
      this.notFound = true;
      this.cdr.detectChanges();
    }
  }

  private mapEwb(raw: any) {
    const validUpto = raw.valid_upto ? new Date(raw.valid_upto) : null;
    const now       = new Date();
    const isExpired = validUpto ? validUpto < now : false;
    const hoursLeft = validUpto && !isExpired
      ? Math.floor((validUpto.getTime() - now.getTime()) / 3600000)
      : null;
    const statusMap: any = {
      active:    { label: 'Active',    icon: '✅', cls: 'status-active'    },
      expired:   { label: 'Expired',   icon: '❌', cls: 'status-expired'   },
      cancelled: { label: 'Cancelled', icon: '🚫', cls: 'status-cancelled' },
      delivered: { label: 'Delivered', icon: '📦', cls: 'status-delivered' },
    };
    const s = statusMap[raw.status] || { label: raw.status, icon: '🚛', cls: 'status-transit' };
    const timeline  = (raw.timeline || []).map((t: any, i: number) => ({ ...t, isCurrent: i === 0 }));
    const mapPoints = (raw.timeline || [])
      .filter((t: any) => t.latitude && t.longitude)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const taxable    = parseFloat(raw.taxable_value || 0);
    const cgstAmt    = (taxable * parseFloat(raw.cgst_rate  || 0)) / 100;
    const sgstAmt    = (taxable * parseFloat(raw.sgst_rate  || 0)) / 100;
    const igstAmt    = (taxable * parseFloat(raw.igst_rate  || 0)) / 100;
    const totalValue = taxable + cgstAmt + sgstAmt + igstAmt;

    return {
      ewb_number:     raw.ewb_number,
      consignment_no: raw.consignment_no,
      origin:         raw.origin      || '—',
      destination:    raw.destination || '—',
      distance_km:    raw.distance_km,
      status:         raw.status,
      statusLabel:    s.label,
      statusIcon:     s.icon,
      statusClass:    s.cls,
      valid_upto:     raw.valid_upto,
      isExpired,
      hoursLeft,
      timeline,
      hasTimeline:  timeline.length > 0,
      mapPoints,
      hasMapPoints: mapPoints.length > 0,
      goods: raw.hsn_code || raw.goods_description || raw.quantity ? {
        hsn_code:          raw.hsn_code          || '—',
        goods_description: raw.goods_description || '—',
        quantity:          raw.quantity          ?? null,
        unit:              raw.unit              || '',
        taxable_value:     taxable               || null,
        cgst_rate:         raw.cgst_rate         ?? null,
        sgst_rate:         raw.sgst_rate         ?? null,
        igst_rate:         raw.igst_rate         ?? null,
        cgst_amount:       cgstAmt,
        sgst_amount:       sgstAmt,
        igst_amount:       igstAmt,
        total_value:       totalValue,
      } : null,
      transport: raw.transporter_name || raw.vehicle_number ? {
        transporter_name:  raw.transporter_name  || '—',
        transporter_gstin: raw.transporter_gstin || null,
        vehicle_number:    raw.vehicle_number    || '—',
        vehicle_type:      raw.vehicle_type      || null,
      } : null,
    };
  }
}
