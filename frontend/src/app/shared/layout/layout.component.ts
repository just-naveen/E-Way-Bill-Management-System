import { Component } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../sidebar/sidebar';
import { NavbarComponent } from '../navbar/navbar';
import { filter, map } from 'rxjs/operators';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, NavbarComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css']
})
export class LayoutComponent {
  pageTitle = 'Dashboard';
  sidebarCollapsed = false;

  private titleMap: Record<string, string> = {
    '/portal/dashboard':    'Dashboard',
    '/portal/consignment':  'Consignment Booking',
    '/portal/ewaybill':     'E-Way Bill',
    '/portal/customers':    'Customers',
    '/portal/vehicles':     'Vehicles',
    '/portal/transporters': 'Transporters',
    '/portal/reports':      'Reports & Analytics',
    '/portal/users':        'User Management',
  };

  constructor(private router: Router) {
    // Restore sidebar state on load
    this.sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';

    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        map((e: any) => this.titleMap[e.urlAfterRedirects] || 'Dashboard')
      )
      .subscribe(title => this.pageTitle = title);
  }

  onCollapseChange(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
  }
}
