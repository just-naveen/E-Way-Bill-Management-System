import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Ewaybill } from './ewaybill';

describe('Ewaybill', () => {
  let component: Ewaybill;
  let fixture: ComponentFixture<Ewaybill>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Ewaybill],
    }).compileComponents();

    fixture = TestBed.createComponent(Ewaybill);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
