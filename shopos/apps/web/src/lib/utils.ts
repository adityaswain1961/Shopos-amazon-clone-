import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(amount: number | string, currency = 'INR') {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(n);
}

export function getGuestCartId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('shopos_guest_cart');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('shopos_guest_cart', id);
  }
  return id;
}
