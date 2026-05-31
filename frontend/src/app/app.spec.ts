import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AppComponent,
        RouterTestingModule,
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should redirect to /login if token is expired', fakeAsync(() => {
    const expiredPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }));
    localStorage.setItem('access_token', `header.${expiredPayload}.signature`);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    tick();

    expect(localStorage.getItem('access_token')).toBeNull();
    localStorage.clear();
  }));

  it('should not redirect if token is valid', fakeAsync(() => {
    const validPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('access_token', `header.${validPayload}.signature`);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    tick();

    expect(localStorage.getItem('access_token')).not.toBeNull();
    localStorage.clear();
  }));

  it('should clear storage and redirect if token is malformed', fakeAsync(() => {
    localStorage.setItem('access_token', 'not-a-valid-jwt');

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    tick();

    expect(localStorage.getItem('access_token')).toBeNull();
    localStorage.clear();
  }));
});
