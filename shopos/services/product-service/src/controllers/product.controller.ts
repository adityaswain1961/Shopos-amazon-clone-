import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { getPrismaClient } from '../config/prisma.js';
import { publishEvent } from '../config/kafka.js';
import { sendSuccess } from '../utils/apiResponse.js';
import type { KafkaEvent, ProductCreatedPayload, ProductUpdatedPayload } from '@shopos/shared-types';

const prisma = getPrismaClient();

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function toSearchPayload(product: {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  basePrice: Prisma.Decimal;
  currency: string;
  status: string;
  tags: string[];
  categoryId: string | null;
}) {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description ?? '',
    price: product.basePrice.toString(),
    currency: product.currency,
    status: product.status,
    tags: product.tags,
    categoryId: product.categoryId,
  };
}

async function emitProductCreated(product: Awaited<ReturnType<typeof prisma.product.create>>) {
  const event: KafkaEvent<ProductCreatedPayload> = {
    eventId: uuidv4(),
    type: 'product.created',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: {
      id: product.id,
      name: product.title,
      slug: product.slug,
      sku: product.id,
      price: product.basePrice.toString(),
      currency: product.currency,
      categoryId: product.categoryId ?? '',
      status: product.status,
      brand: '',
      createdAt: product.createdAt.toISOString(),
    },
  };
  await publishEvent('product.created', { ...event, searchDocument: toSearchPayload(product) });
}

async function emitProductUpdated(id: string, fields: string[]) {
  const event: KafkaEvent<ProductUpdatedPayload> = {
    eventId: uuidv4(),
    type: 'product.updated',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: { id, updatedFields: fields, updatedAt: new Date().toISOString() },
  };
  const product = await prisma.product.findUnique({ where: { id } });
  await publishEvent('product.updated', {
    ...event,
    searchDocument: product ? toSearchPayload(product) : undefined,
  });
}

export const createProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, sellerId, basePrice, categoryId, description, status, comparePrice, currency, tags } =
      req.body;
    const slug = req.body.slug ?? slugify(title);

    const product = await prisma.product.create({
      data: {
        title,
        slug,
        sellerId,
        basePrice,
        comparePrice,
        categoryId,
        description,
        status: status ?? 'draft',
        currency: currency ?? 'INR',
        tags: tags ?? [],
      },
      include: { variants: true, images: true, category: true },
    });

    await emitProductCreated(product);
    res.status(201);
    sendSuccess(res, product);
  } catch (error) {
    next(error);
  }
};

export const getProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const products = await prisma.product.findMany({
      where: status ? { status } : undefined,
      include: { variants: true, images: true, category: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 50, 100),
    });
    sendSuccess(res, products);
  } catch (error) {
    next(error);
  }
};

export const getProductById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idOrSlug = String(req.params.id);
    const product = await prisma.product.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { variants: true, images: true, category: true, videos: true },
    });
    if (!product) {
      res.status(404).json({ success: false, data: null, error: 'Product not found' });
      return;
    }
    sendSuccess(res, product);
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await prisma.product.update({
      where: { id: String(req.params.id) },
      data: req.body,
      include: { variants: true, images: true },
    });
    await emitProductUpdated(product.id, Object.keys(req.body));
    sendSuccess(res, product);
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await prisma.product.update({
      where: { id: String(req.params.id) },
      data: { status: 'archived' },
    });
    await emitProductUpdated(product.id, ['status']);
    sendSuccess(res, product);
  } catch (error) {
    next(error);
  }
};
