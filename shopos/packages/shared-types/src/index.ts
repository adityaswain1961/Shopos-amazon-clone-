// ─── API Response Envelope ───────────────────────────────────────────
// All ShopOS endpoints MUST return this shape.

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
  meta?: Record<string, unknown>;
}

// ─── Pagination ─────────────────────────────────────────────────────

export interface PaginationMeta {
  next_cursor: string | null;
  has_more: boolean;
  total?: number;
}

// ─── JWT ────────────────────────────────────────────────────────────

export interface JwtPayload {
  /** User ID */
  sub: string;
  email: string;
  roles: UserRole[];
  permissions: string[];
  iat: number;
  exp: number;
}

// ─── RBAC ───────────────────────────────────────────────────────────

export enum UserRole {
  CUSTOMER = 'customer',
  SELLER = 'seller',
  ADMIN = 'admin',
  SUPPORT = 'support',
  SUPER_ADMIN = 'super_admin',
}

// ─── Kafka Event Envelope ───────────────────────────────────────────
// All Kafka messages MUST follow this envelope.

export interface KafkaEvent<T> {
  eventId: string;
  type: string;
  timestamp: string; // ISO 8601 UTC
  version: string;
  payload: T;
}

// ─── Common Kafka Event Payloads ────────────────────────────────────

export interface UserRegisteredPayload {
  userId: string;
  email: string;
  roles: UserRole[];
  registeredAt: string;
}

export interface UserEmailVerifiedPayload {
  userId: string;
  email: string;
  verifiedAt: string;
}

export interface PasswordResetRequestedPayload {
  userId: string;
  email: string;
  requestedAt: string;
}

// ─── User Service Kafka Event Payloads ──────────────────────────────

export interface UserProfileUpdatedPayload {
  userId: string;
  updatedFields: string[];
  updatedAt: string;
}

// ─── Product Service Kafka Event Payloads ───────────────────────────

export interface ProductCreatedPayload {
  id: string;
  name: string;
  slug: string;
  sku: string;
  price: string;
  currency: string;
  categoryId: string;
  status: string;
  brand: string;
  createdAt: string;
}

export interface ProductUpdatedPayload {
  id: string;
  updatedFields: string[];
  updatedAt: string;
}

export interface ProductDeletedPayload {
  id: string;
  deletedAt: string;
}

export interface CategoryCreatedPayload {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  createdAt: string;
}

export interface CategoryUpdatedPayload {
  id: string;
  name?: string;
  slug?: string;
  parentId?: string | null;
  updatedAt: string;
}

export interface CategoryDeletedPayload {
  id: string;
  deletedAt: string;
}

// ─── Auth-specific types ────────────────────────────────────────────

export interface DeviceInfo {
  ua: string;
  ip: string;
  fingerprint?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export interface OAuthProvider {
  provider: 'google' | 'github' | 'apple';
  providerId: string;
  accessToken?: string;
}
