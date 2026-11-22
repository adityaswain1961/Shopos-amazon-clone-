export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
  meta?: Record<string, unknown>;
}

export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
  isEmailVerified?: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  tokens: TokenPair;
  user: AuthUser;
}

export interface ProductImage {
  id: string;
  url: string;
  altText?: string | null;
  isPrimary?: boolean;
  position?: number;
}

export interface ProductVariant {
  id: string;
  sku: string;
  price?: string | number | null;
  attributes?: Record<string, string>;
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  basePrice: string | number;
  comparePrice?: string | number | null;
  currency?: string;
  status: string;
  tags?: string[];
  images?: ProductImage[];
  variants?: ProductVariant[];
  category?: { id: string; name: string; slug: string } | null;
  highlights?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export interface CartItem {
  productId: string;
  variantId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl: string;
  slug?: string;
}

export interface ShippingAddress {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country?: string;
  phone: string;
}

export interface OrderItem {
  productId: string;
  variantId?: string | null;
  productTitle: string;
  sku: string;
  quantity: number;
  unitPrice: number | string;
  totalPrice: number | string;
}

export interface Order {
  id: string;
  orderNumber: string;
  /** pending → confirmed | cancelled | payment_failed → shipped → delivered */
  status: string;
  sagaStatus?: string;
  subtotalAmount?: number | string;
  discountAmount?: number | string;
  totalAmount?: number | string;
  currency?: string;
  failureReason?: string | null;
  createdAt?: string;
  userId?: string;
  items?: OrderItem[];
}

export interface SearchResult {
  id?: string;
  title?: string;
  slug?: string;
  price?: string;
  description?: string;
}
