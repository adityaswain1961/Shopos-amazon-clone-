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

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount?: number | string;
  createdAt?: string;
  userId?: string;
}

export interface SearchResult {
  id?: string;
  title?: string;
  slug?: string;
  price?: string;
  description?: string;
}
