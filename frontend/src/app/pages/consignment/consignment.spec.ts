import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Consignment } from './consignment';

describe('Consignment', () => {
  let component: Consignment;
  let fixture: ComponentFixture<Consignment>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Consignment],
    }).compileComponents();

    fixture = TestBed.createComponent(Consignment);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
