/**
 * validators.ts
 * Shared form validation helpers for WayBillPro.
 * Import and call these in vehicle, customer, transporter save() methods.
 *
 * Usage:
 *   import { WayBillValidators } from '../../core/validators';
 *   const err = WayBillValidators.vehicleNumber('TN01AB1234');
 *   if (err) { this.errorMsg = err; return; }
 */

export class WayBillValidators {

  // ── Vehicle Number ──────────────────────────────────────────────────────────
  // Indian vehicle number format: XX00XX0000 or XX00X0000
  // Examples: TN01AB1234, MH12IJ7890, KA03C1234
  private static VEHICLE_REGEX = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/;

  static vehicleNumber(value: string): string {
    if (!value || !value.trim()) {
      return 'Vehicle number is required.';
    }
    const v = value.trim().toUpperCase().replace(/\s/g, '');
    if (!this.VEHICLE_REGEX.test(v)) {
      return 'Invalid vehicle number. Format: TN01AB1234 (state code + RTO + series + number)';
    }
    return '';
  }

  // ── GSTIN ───────────────────────────────────────────────────────────────────
  // GST Identification Number: 15 characters
  // Format: 2-digit state code + 10-char PAN + 1-digit entity + Z + 1 checksum
  // Example: 33AABCU9603R1ZX
  private static GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  static gstin(value: string): string {
    if (!value || !value.trim()) return ''; // GSTIN is optional in your forms
    const v = value.trim().toUpperCase();
    if (v.length !== 15) {
      return 'GSTIN must be exactly 15 characters.';
    }
    if (!this.GSTIN_REGEX.test(v)) {
      return 'Invalid GSTIN format. Example: 33AABCU9603R1ZX';
    }
    return '';
  }

  // ── Mobile Number ───────────────────────────────────────────────────────────
  // Indian mobile: 10 digits, starts with 6–9
  private static MOBILE_REGEX = /^[6-9][0-9]{9}$/;

  static mobile(value: string): string {
    if (!value || !value.trim()) return ''; // mobile is optional in your forms
    const v = value.trim().replace(/\D/g, '');
    if (v.length !== 10) {
      return 'Mobile number must be 10 digits.';
    }
    if (!this.MOBILE_REGEX.test(v)) {
      return 'Invalid mobile number. Must start with 6, 7, 8 or 9.';
    }
    return '';
  }

  // ── Email ───────────────────────────────────────────────────────────────────
  private static EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  static email(value: string): string {
    if (!value || !value.trim()) return ''; // email is optional in your forms
    if (!this.EMAIL_REGEX.test(value.trim())) {
      return 'Invalid email address.';
    }
    return '';
  }

  // ── Name (required, min 2 chars) ────────────────────────────────────────────
  static name(value: string, label = 'Name'): string {
    if (!value || !value.trim()) {
      return `${label} is required.`;
    }
    if (value.trim().length < 2) {
      return `${label} must be at least 2 characters.`;
    }
    return '';
  }
}
