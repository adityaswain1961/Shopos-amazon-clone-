import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { getPrismaClient } from '../config/prisma.js';
import { publishEvent } from '../config/kafka.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';
import { AppError } from '../utils/appError.js';
import { getOrLoad, invalidate, listGeneration, bumpListGeneration, hashKey } from '../services/cache.js';
import { generateSlug } from '../services/categoryService.js';
import type { CreateProductInput, UpdateProductInput, ProductListQuery } from '../validators/product.validators.js';
import type { KafkaEvent, ProductCreatedPayload, ProductUpdatedPayload } from '@shopos/shared-types';

const prisma = getPrismaClient();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DETAIL_TTL = 300; // 5 min in Redis; writes invalidate immediately
const LIST_TTL = 60;
const PRIVILEGED = ['admin', 'super_admin'];

// Browser may reuse for 30s, CDN/Kong for 60s, and both may serve a stale copy
// for 5 min while revalidating in the background. This alone keeps the vast
// majority of catalog traffic off the origin.
const PUBLIC_CACHE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';

// ─── Public projection (never expose costPrice) ─────────────────────

const publicListSelect = {
  id: true,
  title: true,
  slug: true,
  status: true,
  basePrice: true,
  comparePrice: true,
  currency: true,
  tags: true,
  isFeatured: true,
  isSponsored: true,
  categoryId: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true } },
  images: {
    select: { id: true, url: true, altText: true, isPrimary: true, position: true },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
    take: 1,
  },
  variants: {
    select: { id: true, sku: true, price: true },
    orderBy: { createdAt: 'asc' },
    take: 1,
  },
} satisfies Prisma.ProductSelect;

const publicDetailSelect = {
  ...publicListSelect,
  sellerId: true,
  description: true,
  highlights: true,
  specs: true,
  seoTitle: true,
  seoDescription: true,
  updatedAt: true,
  images: {
    select: { id: true, url: true, altText: true, isPrimary: true, position: true, variantId: true },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
  },
  variants: {
    select: { id: true, sku: true, barcode: true, price: true, attributes: true },
    orderBy: { createdAt: 'asc' },
  },
  videos: { select: { id: true, hlsUrl: true, thumbnail: true, durationS: true } },
} satisfies Prisma.ProductSelect;

type DetailRow = Prisma.ProductGetPayload<{ select: typeof publicDetailSelect }>;

const detailKey = (idOrSlug: string) => `products:v2:detail:${idOrSlug.toLowerCase()}`;

// ─── Helpers ────────────────────────────────────────────────────────

function isPrivileged(req: Request): boolean {
  return !!req.user?.roles?.some((r) => PRIVILEGED.includes(r));
}

function searchDocument(p: {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  basePrice: Prisma.Decimal;
  currency: string;
  status: string;
  tags: string[];
  categoryId: string | null;
  createdAt?: Date;
}) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    description: (p.description ?? '').slice(0, 2000),
    price: p.basePrice.toString(),
    currency: p.currency,
    status: p.status,
    tags: p.tags,
    categoryId: p.categoryId,
    createdAt: p.createdAt?.toISOString(),
  };
}

interface Cursor {
  v: string; // sort value (ISO date or price string)
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw?: string): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.v !== 'string' || typeof c.id !== 'string' || !UUID_RE.test(c.id)) return null;
    return c;
  } catch {
    return null;
  }
}

async function afterWrite(product: { id: string; slug: string }, oldSlug?: string) {
  const keys = [detailKey(product.id), detailKey(product.slug)];
  if (oldSlug && oldSlug !== product.slug) keys.push(detailKey(oldSlug));
  await Promise.all([invalidate(...keys), bumpListGeneration()]);
}

// ─── List (keyset pagination) ───────────────────────────────────────

export async function getProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as unknown as ProductListQuery;

    if (q.mine && !req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const cursor = decodeCursor(q.cursor);
    if (q.cursor && !cursor) {
      sendError(res, 'Invalid cursor', 400);
      return;
    }

    const where: Prisma.ProductWhereInput = {};
    if (q.mine) {
      where.sellerId = req.user!.sub;
      if (q.status) where.status = q.status;
    } else {
      // The public storefront only ever sees published products.
      where.status = 'published';
    }
    if (q.categoryId) where.categoryId = q.categoryId;
    else if (q.categorySlug) where.category = { slug: q.categorySlug };
    if (q.tag) where.tags = { has: q.tag.toLowerCase() };
    if (q.featured !== undefined) where.isFeatured = q.featured;
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      where.basePrice = {
        ...(q.minPrice !== undefined && { gte: new Prisma.Decimal(q.minPrice) }),
        ...(q.maxPrice !== undefined && { lte: new Prisma.Decimal(q.maxPrice) }),
      };
    }

    let orderBy: Prisma.ProductOrderByWithRelationInput[];
    let cursorWhere: Prisma.ProductWhereInput | undefined;
    if (q.sort === 'price_asc' || q.sort === 'price_desc') {
      const dir = q.sort === 'price_asc' ? 'asc' : 'desc';
      const cmp = dir === 'asc' ? 'gt' : 'lt';
      orderBy = [{ basePrice: dir }, { id: dir }];
      if (cursor) {
        const v = new Prisma.Decimal(cursor.v);
        cursorWhere = {
          OR: [{ basePrice: { [cmp]: v } }, { basePrice: v, id: { [cmp]: cursor.id } }],
        };
      }
    } else {
      orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
      if (cursor) {
        const v = new Date(cursor.v);
        cursorWhere = { OR: [{ createdAt: { lt: v } }, { createdAt: v, id: { lt: cursor.id } }] };
      }
    }

    const load = async () => {
      const rows = await prisma.product.findMany({
        where: cursorWhere ? { AND: [where, cursorWhere] } : where,
        orderBy,
        take: q.limit + 1, // fetch one extra to know if there's another page
        select: publicListSelect,
      });
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              v: q.sort === 'newest' ? last.createdAt.toISOString() : last.basePrice.toString(),
              id: last.id,
            })
          : null;
      return { items, nextCursor, hasMore };
    };

    // Personal ("mine") listings are never cached or shared.
    const page = q.mine
      ? await load()
      : await getOrLoad(`products:v2:list:${await listGeneration()}:${hashKey(q)}`, LIST_TTL, load);

    res.set('Cache-Control', q.mine ? 'private, no-store' : PUBLIC_CACHE);
    sendSuccess(res, page?.items ?? [], 200, {
      next_cursor: page?.nextCursor ?? null,
      has_more: page?.hasMore ?? false,
    });
  } catch (error) {
    next(error);
  }
}

// ─── Detail ─────────────────────────────────────────────────────────

export async function getProductById(req: Request, res: Response, next: NextFunction) {
  try {
    const idOrSlug = String(req.params.id).trim();
    if (!idOrSlug || idOrSlug.length > 350) {
      sendError(res, 'Product not found', 404);
      return;
    }

    // Querying a UUID column with a slug string is a Postgres error, so pick
    // the lookup column up-front instead of OR-ing id/slug.
    const where: Prisma.ProductWhereUniqueInput = UUID_RE.test(idOrSlug)
      ? { id: idOrSlug }
      : { slug: idOrSlug.toLowerCase() };

    const product = await getOrLoad<DetailRow>(
      detailKey(idOrSlug),
      DETAIL_TTL,
      () => prisma.product.findUnique({ where, select: publicDetailSelect }),
      { negativeTtlSeconds: 30 },
    );

    const visible =
      product &&
      (product.status === 'published' ||
        product.status === 'out_of_stock' ||
        isPrivileged(req) ||
        (req.user && req.user.sub === product.sellerId));

    if (!visible) {
      // A truly missing slug can be cached publicly (bots, typos). A product
      // that exists but is hidden (draft/archived) must not be: the gateway
      // cache would then serve that 404 to the owning seller too.
      res.set('Cache-Control', product ? 'private, no-store' : 'public, max-age=10, s-maxage=30');
      sendError(res, 'Product not found', 404);
      return;
    }

    res.set('Cache-Control', product.status === 'published' ? PUBLIC_CACHE : 'private, no-store');
    sendSuccess(res, product);
  } catch (error) {
    next(error);
  }
}

// ─── Create ─────────────────────────────────────────────────────────

export async function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as CreateProductInput;
    const admin = isPrivileged(req);
    const slug = generateSlug(body.slug ?? body.title);
    if (!slug) throw new AppError('Could not derive a slug from the title', 400);

    const hasPrimary = body.images.some((i) => i.isPrimary);

    const product = await prisma.product.create({
      data: {
        sellerId: req.user!.sub, // always the caller — never from the body
        title: body.title,
        slug,
        description: body.description,
        highlights: body.highlights,
        specs: body.specs as Prisma.InputJsonValue | undefined,
        status: body.status,
        basePrice: new Prisma.Decimal(body.basePrice),
        comparePrice: body.comparePrice != null ? new Prisma.Decimal(body.comparePrice) : null,
        costPrice: body.costPrice != null ? new Prisma.Decimal(body.costPrice) : null,
        taxClass: body.taxClass,
        currency: body.currency,
        tags: body.tags,
        seoTitle: body.seoTitle,
        seoDescription: body.seoDescription,
        categoryId: body.categoryId ?? null,
        isFeatured: admin ? body.isFeatured ?? false : false,
        isSponsored: admin ? body.isSponsored ?? false : false,
        variants: {
          create: body.variants.map((v) => ({
            sku: v.sku,
            barcode: v.barcode,
            price: v.price != null ? new Prisma.Decimal(v.price) : null,
            attributes: v.attributes,
          })),
        },
        images: {
          create: body.images.map((img, i) => ({
            url: img.url,
            altText: img.altText,
            position: img.position ?? i,
            isPrimary: img.isPrimary ?? (!hasPrimary && i === 0),
          })),
        },
      },
      select: { ...publicDetailSelect, costPrice: true },
    });

    await bumpListGeneration();

    const event: KafkaEvent<ProductCreatedPayload> = {
      eventId: uuidv4(),
      type: 'product.created',
      timestamp: new Date().toISOString(),
      version: '1.0',
      payload: {
        id: product.id,
        name: product.title,
        slug: product.slug,
        sku: product.variants[0]?.sku ?? product.id,
        price: product.basePrice.toString(),
        currency: product.currency,
        categoryId: product.categoryId ?? '',
        status: product.status,
        brand: '',
        createdAt: product.createdAt.toISOString(),
      },
    };
    void publishEvent('product.created', { ...event, searchDocument: searchDocument(product) }, product.id);

    sendSuccess(res, product, 201);
  } catch (error) {
    next(error);
  }
}

// ─── Update ─────────────────────────────────────────────────────────

async function loadOwned(req: Request, id: string) {
  if (!UUID_RE.test(id)) throw new AppError('Product not found', 404);
  const current = await prisma.product.findUnique({
    where: { id },
    select: { id: true, slug: true, sellerId: true, basePrice: true },
  });
  if (!current) throw new AppError('Product not found', 404);
  if (!isPrivileged(req) && current.sellerId !== req.user!.sub) {
    throw new AppError('You can only modify your own products', 403);
  }
  return current;
}

export async function updateProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id);
    const current = await loadOwned(req, id);
    const body = req.body as UpdateProductInput;
    const admin = isPrivileged(req);

    // Explicit whitelist → Prisma. Anything not listed here cannot be written.
    const data: Prisma.ProductUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.slug !== undefined) data.slug = generateSlug(body.slug);
    if (body.description !== undefined) data.description = body.description;
    if (body.highlights !== undefined) data.highlights = body.highlights;
    if (body.specs !== undefined) data.specs = body.specs as Prisma.InputJsonValue;
    if (body.status !== undefined) data.status = body.status;
    if (body.basePrice !== undefined) data.basePrice = new Prisma.Decimal(body.basePrice);
    if (body.comparePrice !== undefined)
      data.comparePrice = body.comparePrice != null ? new Prisma.Decimal(body.comparePrice) : null;
    if (body.costPrice !== undefined)
      data.costPrice = body.costPrice != null ? new Prisma.Decimal(body.costPrice) : null;
    if (body.taxClass !== undefined) data.taxClass = body.taxClass;
    if (body.currency !== undefined) data.currency = body.currency;
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.seoTitle !== undefined) data.seoTitle = body.seoTitle;
    if (body.seoDescription !== undefined) data.seoDescription = body.seoDescription;
    if (body.categoryId !== undefined)
      data.category = body.categoryId ? { connect: { id: body.categoryId } } : { disconnect: true };
    if (admin && body.isFeatured !== undefined) data.isFeatured = body.isFeatured;
    if (admin && body.isSponsored !== undefined) data.isSponsored = body.isSponsored;

    const priceChanged = body.basePrice !== undefined && !current.basePrice.equals(body.basePrice);

    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data,
        select: { ...publicDetailSelect, costPrice: true },
      });
      if (priceChanged) {
        await tx.priceHistory.create({
          data: { productId: id, price: updated.basePrice, changedBy: req.user!.sub },
        });
      }
      return updated;
    });

    await afterWrite(product, current.slug);

    const event: KafkaEvent<ProductUpdatedPayload> = {
      eventId: uuidv4(),
      type: 'product.updated',
      timestamp: new Date().toISOString(),
      version: '1.0',
      payload: { id, updatedFields: Object.keys(data), updatedAt: product.updatedAt.toISOString() },
    };
    void publishEvent('product.updated', { ...event, searchDocument: searchDocument(product) }, id);

    if (priceChanged && product.basePrice.lessThan(current.basePrice)) {
      void publishEvent(
        'product.price_dropped',
        {
          eventId: uuidv4(),
          type: 'product.price_dropped',
          timestamp: new Date().toISOString(),
          version: '1.0',
          payload: {
            productId: id,
            title: product.title,
            slug: product.slug,
            oldPrice: current.basePrice.toString(),
            newPrice: product.basePrice.toString(),
            currency: product.currency,
          },
        },
        id,
      );
    }

    sendSuccess(res, product);
  } catch (error) {
    next(error);
  }
}

// ─── Delete (soft: archive) ─────────────────────────────────────────

export async function deleteProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id);
    const current = await loadOwned(req, id);

    const product = await prisma.product.update({
      where: { id },
      data: { status: 'archived' },
      select: publicDetailSelect,
    });

    await afterWrite(product, current.slug);

    void publishEvent(
      'product.updated',
      {
        eventId: uuidv4(),
        type: 'product.updated',
        timestamp: new Date().toISOString(),
        version: '1.0',
        payload: { id, updatedFields: ['status'], updatedAt: new Date().toISOString() },
        searchDocument: searchDocument(product),
      },
      id,
    );

    sendSuccess(res, { id, status: product.status });
  } catch (error) {
    next(error);
  }
}
